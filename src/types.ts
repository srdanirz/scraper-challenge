export interface ScrapedDocument {
    id: string; // The 'ri' (row index) or another unique identifier if possible
    expediente: string;
    administrado: string;
    unidadFiscalizable: string;
    sector: string;
    resolucion: string;
    downloadUuid: string; // The param_uuid needed for download
    downloadUrl?: string; // Constructed URL if needed, or just the UUID
    localPdfPath?: string;
}

export interface ScraperConfig {
    baseUrl: string;
    outputDir: string;
    delayBetweenRequests: number; // ms
    maxRetries: number;
}
