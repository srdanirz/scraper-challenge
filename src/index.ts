import { Scraper } from './scraper';
import { ScraperConfig } from './types';
import * as path from 'path';

const config: ScraperConfig = {
    baseUrl: 'https://publico.oefa.gob.pe',
    outputDir: path.join(__dirname, '../downloads'),
    delayBetweenRequests: 2000, // 2 seconds delay as requested (generous)
    maxRetries: 5
};

const scraper = new Scraper(config);

(async () => {
    try {
        await scraper.scrape();
    } catch (error) {
        console.error('Fatal error during scraping:', error);
        process.exit(1);
    }
})();
