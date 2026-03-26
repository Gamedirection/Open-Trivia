import pkg from '../package.json';

const runtimeConfig = (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) || {};
const runtimeVersion = String(runtimeConfig.VERSION || '').trim();
const runtimeLogoUrl = String(runtimeConfig.BRAND_LOGO_URL || '').trim();
const defaultLogoUrl = '/img/open-trivia-logo.svg';
const configuredPublicSiteUrl = String(runtimeConfig.PUBLIC_SITE_URL || process.env.REACT_APP_PUBLIC_SITE_URL || '').trim();
const configuredLegalOperatorName = String(runtimeConfig.LEGAL_OPERATOR_NAME || process.env.REACT_APP_LEGAL_OPERATOR_NAME || '').trim();
const configuredLegalContactEmail = String(runtimeConfig.LEGAL_CONTACT_EMAIL || process.env.REACT_APP_LEGAL_CONTACT_EMAIL || '').trim();
const configuredLegalLastUpdated = String(runtimeConfig.LEGAL_LAST_UPDATED || process.env.REACT_APP_LEGAL_LAST_UPDATED || '').trim();

export const BRAND_LOGO_URL = runtimeLogoUrl || (process.env.REACT_APP_BRAND_LOGO_URL || '').trim() || defaultLogoUrl;
export const APP_VERSION = runtimeVersion || process.env.REACT_APP_VERSION || pkg.version;
export const DISPLAY_VERSION = APP_VERSION.startsWith('v') ? APP_VERSION : `v${APP_VERSION}`;
export const PUBLIC_SITE_URL = configuredPublicSiteUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
export const LEGAL_OPERATOR_NAME = configuredLegalOperatorName;
export const LEGAL_CONTACT_EMAIL = configuredLegalContactEmail;
export const LEGAL_LAST_UPDATED = configuredLegalLastUpdated || '2026-03-25';
