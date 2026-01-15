# Scraper de Jurisprudencia OEFA (Desafío)

Este proyecto es un scraper desarrollado en TypeScript para extraer información y descargar resoluciones del Tribunal de Fiscalización Ambiental del OEFA.

## Características

-   **Navegación robusta**: Maneja cookies de sesión (`JSESSIONID`) y el estado de la vista de JSF (`javax.faces.ViewState`).
-   **Extracción de datos**: Parsea la tabla de resultados y guarda la metadata en `downloads/data.json` **progresivamente** (página por página) para evitar pérdida de datos.
-   **Descarga de PDFs**: Identifica y descarga los documentos asociados, registrando fallos en `downloads/failed_downloads.json`.
-   **Manejo de Rate Limiting**: Implementa "backoff exponencial" para manejar errores `429 Too Many Requests`.
-   **Sin navegador**: Utiliza `axios` y `cheerio`, sin depender de Puppeteer o Selenium, para una ejecución ligera y rápida.

## Requisitos

-   Node.js (v14 o superior)
-   npm

## Instalación

1.  Clona este repositorio o entra al directorio:
    ```bash
    cd scraper-challenge
    ```
2.  Instala las dependencias:
    ```bash
    npm install
    ```

## Ejecución

Para ejecutar el scraper:

```bash
npm start
```

O directamente usando `ts-node`:

```bash
npx ts-node src/index.ts
```

Los PDFs descargados se guardarán en la carpeta `downloads/`.

## Configuración

Puedes ajustar la configuración en `src/index.ts`, incluyendo:

-   `delayBetweenRequests`: Tiempo de espera entre peticiones (por defecto 2000ms).
-   `outputDir`: Directorio de descarga.
-   `maxRetries`: Número de reintentos en caso de errores 429.

## Estructura del Proyecto

-   `src/index.ts`: Punto de entrada.
-   `src/scraper.ts`: Lógica principal del scraper.
-   `src/types.ts`: Definición de interfaces.
-   `src/utils.ts`: Funciones de utilidad (sleep, backoff).

## Notas

La URL objetivo es: `https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml`.
El scraper imita el comportamiento de un navegador enviando las peticiones JSF/AJAX correctas.
