export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const calculateBackoff = (attempt: number, baseDelay: number): number => {
    return Math.min(baseDelay * Math.pow(2, attempt), 60000); // Max 60s
};
