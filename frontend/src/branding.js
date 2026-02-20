import pkg from '../package.json';

const runtimeConfig = (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) || {};
const runtimeVersion = String(runtimeConfig.VERSION || '').trim();
const runtimeLogoUrl = String(runtimeConfig.BRAND_LOGO_URL || '').trim();

export const BRAND_LOGO_URL = runtimeLogoUrl || (process.env.REACT_APP_BRAND_LOGO_URL || '').trim();
export const APP_VERSION = runtimeVersion || process.env.REACT_APP_VERSION || pkg.version;
export const DISPLAY_VERSION = APP_VERSION.startsWith('v') ? APP_VERSION : `v${APP_VERSION}`;
