import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import * as qs from 'qs';
import * as fs from 'fs';
import * as path from 'path';
import { ScrapedDocument, ScraperConfig } from './types';
import { sleep, calculateBackoff } from './utils';

export class Scraper {
    private client: AxiosInstance;
    private jar: CookieJar;
    private viewState: string = '';
    private config: ScraperConfig;

    constructor(config: ScraperConfig) {
        this.config = config;
        this.jar = new CookieJar();
        this.client = wrapper(axios.create({
            baseURL: config.baseUrl,
            jar: this.jar,
            withCredentials: true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Origin': 'https://publico.oefa.gob.pe',
                'Referer': 'https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml'
            },
            timeout: 30000
        }));
    }

    public async init(): Promise<void> {
        console.log('Initializing session...');
        if (!fs.existsSync(this.config.outputDir)) {
            fs.mkdirSync(this.config.outputDir, { recursive: true });
        }
        try {
            const response = await this.client.get('/repdig/consulta/consultaTfa.xhtml');
            const $ = cheerio.load(response.data);
            this.viewState = $('input[name="javax.faces.ViewState"]').val() as string;

            if (!this.viewState) {
                throw new Error('Could not extract initial javax.faces.ViewState');
            }
            console.log('Session initialized. ViewState:', this.viewState);
        } catch (error) {
            console.error('Error initializing session:', error);
            throw error;
        }
    }

    public async initialSearch(): Promise<ScrapedDocument[]> {
        console.log('Performing initial search...');
        const payload = {
            'javax.faces.partial.ajax': 'true',
            'javax.faces.source': 'listarDetalleInfraccionRAAForm:btnBuscar',
            'javax.faces.partial.execute': '@all',
            'javax.faces.partial.render': 'listarDetalleInfraccionRAAForm:pgLista listarDetalleInfraccionRAAForm:txtNroexp',
            'listarDetalleInfraccionRAAForm:btnBuscar': 'listarDetalleInfraccionRAAForm:btnBuscar',
            'listarDetalleInfraccionRAAForm': 'listarDetalleInfraccionRAAForm',
            'listarDetalleInfraccionRAAForm:txtNroexp': '',
            'listarDetalleInfraccionRAAForm:j_idt21': '',
            'listarDetalleInfraccionRAAForm:j_idt25': '',
            'listarDetalleInfraccionRAAForm:idsector': '',
            'listarDetalleInfraccionRAAForm:j_idt34': '',
            'listarDetalleInfraccionRAAForm:dt_scrollState': '0,0',
            'javax.faces.ViewState': this.viewState
        };

        const response = await this.postForm(payload);
        return this.processResponse(response);
    }

    private async postForm(data: any, attempt: number = 0): Promise<any> {
        try {
            await sleep(this.config.delayBetweenRequests); // Respect generic delay

            const response = await this.client.post('/repdig/consulta/consultaTfa.xhtml', qs.stringify(data), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Faces-Request': 'partial/ajax'
                }
            });
            return response.data;
        } catch (error: any) {
            if (error.response && error.response.status === 429) {
                const backoff = calculateBackoff(attempt, 2000);
                console.warn(`429 Too Many Requests. Retrying in ${backoff}ms...`);
                await sleep(backoff);
                if (attempt < this.config.maxRetries) {
                    return this.postForm(data, attempt + 1);
                }
            }
            throw error;
        }
    }

    private async processResponse(xmlData: string): Promise<ScrapedDocument[]> {
        const $xml = cheerio.load(xmlData, { xmlMode: true });

        // Update ViewState if present - Robust check
        let newViewState = $xml('update[id*="ViewState"]').text();
        if (newViewState) {
            this.viewState = newViewState;
            // console.log('ViewState updated:', this.viewState);
        }

        // Extract table content
        // The table wrapper is usually in <update id="listarDetalleInfraccionRAAForm:pgLista"> (search) or "listarDetalleInfraccionRAAForm:dt" (pagination)
        let tableUpdate = $xml('update[id="listarDetalleInfraccionRAAForm:pgLista"]').text();
        if (!tableUpdate) {
            tableUpdate = $xml('update[id="listarDetalleInfraccionRAAForm:dt"]').text();
        }

        if (!tableUpdate) {
            // console.log('No table update found in this response.');
            return [];
        }

        // Now parse the inner HTML of the table update
        // Important: If tableUpdate contains only <tr> elements (common in JSF pagination),
        // cheerio.load() might strip them if not wrapped in a <table> context.
        const $table = cheerio.load(`<table><tbody>${tableUpdate}</tbody></table>`);
        const documents: ScrapedDocument[] = [];

        $table('tr[data-ri]').each((_, el) => {
            const $row = $table(el);
            const tds = $row.find('td');

            const id = $row.attr('data-ri') || '';
            const expediente = $table(tds[1]).text().trim();
            const administrado = $table(tds[2]).text().trim();
            const unidadFiscalizable = $table(tds[3]).text().trim();
            const sector = $table(tds[4]).text().trim();
            const resolucion = $table(tds[5]).text().trim();

            const onclick = $row.find('a').attr('onclick') || '';
            const uuidMatch = onclick.match(/'param_uuid':'([a-f0-9-]+)'/);
            const uuid = uuidMatch ? uuidMatch[1] : '';

            if (uuid) {
                documents.push({
                    id,
                    expediente,
                    administrado,
                    unidadFiscalizable,
                    sector,
                    resolucion,
                    downloadUuid: uuid,
                });
            }
        });

        console.log(`Extracted ${documents.length} documents from current page.`);

        return documents;
    }

    public async downloadPdf(doc: ScrapedDocument): Promise<void> {
        const filename = `${doc.resolucion.replace(/[^a-z0-9]/gi, '_')}_${doc.downloadUuid.substring(0, 8)}.pdf`;
        const filePath = path.join(this.config.outputDir, filename);

        if (fs.existsSync(filePath)) {
            console.log(`File ${filename} already exists. Skipping.`);
            return;
        }

        console.log(`Downloading PDF for ${doc.expediente} (${doc.downloadUuid})...`);

        const payload = {
            'listarDetalleInfraccionRAAForm': 'listarDetalleInfraccionRAAForm',
            'listarDetalleInfraccionRAAForm:txtNroexp': '',
            'listarDetalleInfraccionRAAForm:j_idt21': '',
            'listarDetalleInfraccionRAAForm:j_idt25': '',
            'listarDetalleInfraccionRAAForm:idsector': '',
            'listarDetalleInfraccionRAAForm:j_idt34': '',
            'listarDetalleInfraccionRAAForm:dt_scrollState': '0,0',
            'javax.faces.ViewState': this.viewState,
            [`listarDetalleInfraccionRAAForm:dt:${doc.id}:j_idt63`]: `listarDetalleInfraccionRAAForm:dt:${doc.id}:j_idt63`,
            'param_uuid': doc.downloadUuid
        };

        await this.downloadRequest(payload, filePath);
        console.log(`Downloaded: ${filename}`);
    }

    private async downloadRequest(data: any, filePath: string, attempt: number = 0): Promise<void> {
        try {
            await sleep(this.config.delayBetweenRequests);
            const response = await this.client.post('/repdig/consulta/consultaTfa.xhtml', qs.stringify(data), {
                responseType: 'stream',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                }
            });

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
        } catch (error: any) {
            if (error.response && error.response.status === 429) {
                const backoff = calculateBackoff(attempt, 2000);
                console.warn(`429 during download. Retrying in ${backoff}ms...`);
                await sleep(backoff);
                if (attempt < this.config.maxRetries) {
                    return this.downloadRequest(data, filePath, attempt + 1);
                }
            }
            throw error;
        }
    }

    public async nextPage(startIndex: number): Promise<ScrapedDocument[]> {
        console.log(`Fetching page starting at index ${startIndex}...`);

        // Payload for pagination
        const payload = {
            'javax.faces.partial.ajax': 'true',
            'javax.faces.source': 'listarDetalleInfraccionRAAForm:dt',
            'javax.faces.partial.execute': 'listarDetalleInfraccionRAAForm:dt',
            'javax.faces.partial.render': 'listarDetalleInfraccionRAAForm:dt',
            'listarDetalleInfraccionRAAForm:dt': 'listarDetalleInfraccionRAAForm:dt',
            'listarDetalleInfraccionRAAForm:dt_pagination': 'true',
            'listarDetalleInfraccionRAAForm:dt_first': startIndex.toString(),
            'listarDetalleInfraccionRAAForm:dt_rows': '10', // Rows per page
            'listarDetalleInfraccionRAAForm:dt_skipChildren': 'true',
            'listarDetalleInfraccionRAAForm:dt_encodeFeature': 'true',
            'listarDetalleInfraccionRAAForm': 'listarDetalleInfraccionRAAForm',
            'listarDetalleInfraccionRAAForm:txtNroexp': '',
            'listarDetalleInfraccionRAAForm:j_idt21': '',
            'listarDetalleInfraccionRAAForm:j_idt25': '',
            'listarDetalleInfraccionRAAForm:idsector': '',
            'listarDetalleInfraccionRAAForm:j_idt34': '',
            'listarDetalleInfraccionRAAForm:dt_scrollState': '0,0',
            'javax.faces.ViewState': this.viewState
        };

        const response = await this.postForm(payload);
        return this.processResponse(response);
    }

    public async scrape(): Promise<void> {
        await this.init();

        let allDocs: ScrapedDocument[] = [];

        const pageSize = 10;

        // Tracking failures
        const failedDownloads: { doc: ScrapedDocument, error: any }[] = [];

        // Initial Search (Page 0)
        console.log('Starting scrape...');
        const initialDocs = await this.initialSearch();
        allDocs = allDocs.concat(initialDocs);
        for (const doc of initialDocs) {
            try {
                await this.downloadPdf(doc);
            } catch (e: any) {
                console.error(`Error downloading ${doc.expediente}:`, e.message);
                failedDownloads.push({ doc, error: e.message });
            }
        }

        let currentIndex = 10;
        while (true) {
            try {
                const nextDocs = await this.nextPage(currentIndex);
                if (nextDocs.length === 0) {
                    console.log('No more documents found. Scraping finished.');
                    break;
                }

                allDocs = allDocs.concat(nextDocs);
                for (const doc of nextDocs) {
                    try {
                        await this.downloadPdf(doc);
                    } catch (e: any) {
                        console.error(`Failed to download ${doc.expediente}:`, e.message);
                        failedDownloads.push({ doc, error: e.message || String(e) });
                    }
                }

                currentIndex += pageSize;

                // Save progress incrementally
                fs.writeFileSync(path.join(this.config.outputDir, 'data.json'), JSON.stringify(allDocs, null, 2));
                if (failedDownloads.length > 0) {
                    fs.writeFileSync(path.join(this.config.outputDir, 'failed_downloads.json'), JSON.stringify(failedDownloads, null, 2));
                }
                console.log(`Progress saved: ${allDocs.length} documents generated.`);

            } catch (e) {
                console.error('Error during pagination:', e);
                break;
            }
        }
    }
}
