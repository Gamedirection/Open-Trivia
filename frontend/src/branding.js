import pkg from '../package.json';

export const BRAND_LOGO_URL = (process.env.REACT_APP_BRAND_LOGO_URL || '').trim();
export const APP_VERSION = process.env.REACT_APP_VERSION || pkg.version;
export const DISPLAY_VERSION = APP_VERSION.startsWith('v') ? APP_VERSION : `v${APP_VERSION}`;
