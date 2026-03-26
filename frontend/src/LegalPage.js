import React from 'react';
import { Link } from 'react-router-dom';
import {
  BRAND_LOGO_URL,
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  LEGAL_OPERATOR_NAME,
  PUBLIC_SITE_URL
} from './branding';

function normalizeSiteUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return 'http://localhost:3000';
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  return `https://${raw.replace(/\/+$/, '')}`;
}

function hostnameFromUrl(url) {
  try {
    return new URL(normalizeSiteUrl(url)).hostname.replace(/^www\./i, '');
  } catch {
    return 'this Open-Trivia site';
  }
}

function titleCaseDomain(hostname) {
  return hostname
    .split('.')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

const siteUrl = normalizeSiteUrl(PUBLIC_SITE_URL);
const siteHost = hostnameFromUrl(siteUrl);
const operatorName = LEGAL_OPERATOR_NAME || titleCaseDomain(siteHost);
const legalEmail = String(LEGAL_CONTACT_EMAIL || '').trim();

const sectionStyle = {
  background: 'var(--card-bg)',
  border: '1px solid var(--border-color)',
  borderRadius: '14px',
  padding: '22px',
  marginBottom: '18px',
  boxShadow: '0 8px 20px rgba(0,0,0,0.06)'
};

const proseStyle = {
  margin: '10px 0 0',
  lineHeight: 1.7,
  color: 'var(--text-color)'
};

function LegalLayout({ title, summary, children }) {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link to="/" style={{ textDecoration: 'none', color: 'var(--text-color)', display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
          <img
            src={BRAND_LOGO_URL}
            alt="Open-Trivia"
            style={{ width: '42px', height: '42px', objectFit: 'contain' }}
          />
          <span style={{ fontWeight: 800 }}>Open-Trivia</span>
        </Link>
      </div>

      <div style={{ ...sectionStyle, padding: '28px' }}>
        <h1 style={{ margin: 0, fontSize: '2rem' }}>{title}</h1>
        <p style={{ ...proseStyle, marginTop: '12px', color: '#666' }}>{summary}</p>
        <div style={{ marginTop: '16px', display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.92rem', color: '#666' }}>
          <span><strong>Operator:</strong> {operatorName}</span>
          <span><strong>Site:</strong> <a href={siteUrl} style={{ color: '#007bff', textDecoration: 'none' }}>{siteHost}</a></span>
          <span><strong>Last updated:</strong> {formatDate(LEGAL_LAST_UPDATED)}</span>
        </div>
      </div>

      {children}

      <div style={{ ...sectionStyle, marginTop: '8px' }}>
        <h2 style={{ marginTop: 0 }}>Contact</h2>
        <p style={proseStyle}>
          {legalEmail
            ? <>Questions about these terms or privacy disclosures can be sent to <a href={`mailto:${legalEmail}`} style={{ color: '#007bff', textDecoration: 'none' }}>{legalEmail}</a>.</>
            : <>Questions about these terms or privacy disclosures can be directed to the operator of <a href={siteUrl} style={{ color: '#007bff', textDecoration: 'none' }}>{siteHost}</a>.</>}
        </p>
      </div>
    </div>
  );
}

function LegalSection({ title, children }) {
  return (
    <section style={sectionStyle}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </section>
  );
}

function LegalList({ items }) {
  return (
    <ul style={{ ...proseStyle, paddingLeft: '20px' }}>
      {items.map((item) => (
        <li key={item} style={{ marginBottom: '8px' }}>{item}</li>
      ))}
    </ul>
  );
}

export function TermsOfUsePage() {
  return (
    <LegalLayout
      title="Terms of Use"
      summary={`These Terms of Use govern access to and use of Open-Trivia operated for ${siteHost}. By creating an account, using the website, or interacting with the Discord-connected trivia features, you agree to these terms.`}
    >
      <LegalSection title="Eligibility and Accounts">
        <p style={proseStyle}>
          You must be at least 13 years old, or the minimum age required by local law to use online services in your jurisdiction. Open-Trivia supports email/password accounts, Discord-linked accounts, and some guest-style gameplay features.
        </p>
        <LegalList items={[
          'You are responsible for keeping your account credentials and connected Discord account secure.',
          'You must provide accurate account information and keep it reasonably current.',
          'You are responsible for activity that occurs through your account or Discord identity unless you report unauthorized use promptly.'
        ]} />
      </LegalSection>

      <LegalSection title="Acceptable Use">
        <p style={proseStyle}>
          Open-Trivia may only be used for lawful, fair, and non-abusive gameplay and administration.
        </p>
        <LegalList items={[
          'Do not cheat, exploit scoring or timing systems, automate play, scrape content, or interfere with the service.',
          'Do not upload or submit unlawful, infringing, abusive, or harmful trivia content, reports, imports, or category packs.',
          'Do not impersonate other users, misuse Discord integrations, or attempt to access admin-only features without authorization.'
        ]} />
      </LegalSection>

      <LegalSection title="User Submissions and Community Content">
        <p style={proseStyle}>
          If you submit questions, reports, category packs, imports, suggestions, or other content, you retain ownership of your material. You grant the operator a non-exclusive right to host, review, copy, adapt, moderate, and use that content as needed to operate, improve, and distribute the service.
        </p>
        <p style={proseStyle}>
          You represent that you have the rights needed to submit the content and that it does not violate law or third-party rights.
        </p>
      </LegalSection>

      <LegalSection title="Gameplay, Leaderboards, and Discord Features">
        <p style={proseStyle}>
          Trivia questions, scores, schedules, leaderboards, categories, Discord bot behavior, and account-linking features are provided on an operational basis and may change over time.
        </p>
        <LegalList items={[
          'Scores, rankings, question availability, and scheduled trivia runs may be corrected, reset, delayed, or removed.',
          'Discord bot participation may create or link an Open-Trivia user profile for leaderboard tracking and service operation.',
          'We may limit, disable, or alter gameplay features when needed for moderation, maintenance, anti-abuse, or product changes.'
        ]} />
      </LegalSection>

      <LegalSection title="Suspension and Termination">
        <p style={proseStyle}>
          The operator may suspend, block, restrict, or terminate access to Open-Trivia, remove submissions, or disable Discord integrations if needed to enforce these terms, protect the service, comply with legal obligations, or address abuse, cheating, or operational risk.
        </p>
      </LegalSection>

      <LegalSection title="Availability, Disclaimers, and Liability Limits">
        <p style={proseStyle}>
          Open-Trivia is provided on an “as is” and “as available” basis. The operator does not guarantee uninterrupted availability, perfect data accuracy, or error-free gameplay, scoring, or third-party integrations.
        </p>
        <p style={proseStyle}>
          To the fullest extent permitted by law, the operator is not liable for indirect, incidental, special, consequential, or punitive damages arising from use of the service, inability to access it, content submissions, account actions, Discord integrations, or loss of data. Where liability cannot be excluded, it is limited to the amount you paid for the service, if any.
        </p>
      </LegalSection>

      <LegalSection title="Changes to These Terms">
        <p style={proseStyle}>
          These Terms may be updated from time to time. Continued use of Open-Trivia after an update becomes effective means you accept the revised Terms.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      summary={`This Privacy Policy explains what information Open-Trivia collects, how it is used, and the privacy controls available to users of ${siteHost}, including website and Discord-connected features.`}
    >
      <LegalSection title="Information We Collect">
        <LegalList items={[
          'Account information such as email address, password hash, display name, and email-visibility preference.',
          'Discord-linked information such as Discord ID, username, avatar URL, and login/linking metadata.',
          'Gameplay information such as answers, scores, category activity, leaderboard results, anonymous session activity, and Discord trivia responses.',
          'Operational and moderation information such as password reset tokens, audit logs, account blocks, abuse/rate-limit records, and admin actions.',
          'Stored service data included in backups, exports, imports, and restore workflows when those features are used.'
        ]} />
      </LegalSection>

      <LegalSection title="How Information Is Collected">
        <LegalList items={[
          'Directly from you when you register, sign in, edit your profile, request password resets, submit content, or use admin tools.',
          'From Discord when you sign in with Discord, link a Discord account, or answer questions through the Discord bot.',
          'Automatically through service operation when you play games, appear on leaderboards, trigger moderation rules, or interact with bot schedules and trivia sessions.'
        ]} />
      </LegalSection>

      <LegalSection title="How We Use Information">
        <LegalList items={[
          'To authenticate accounts, maintain profiles, and support password reset and account-linking flows.',
          'To run trivia gameplay, calculate scores, power leaderboards, and operate Discord bot features and schedules.',
          'To moderate content, prevent abuse, investigate incidents, and enforce service rules.',
          'To maintain backups, exports, restore functions, and administrative records.',
          'To communicate service or legal issues when reasonably necessary.'
        ]} />
      </LegalSection>

      <LegalSection title="Privacy Controls and Visibility">
        <p style={proseStyle}>
          Open-Trivia includes built-in privacy controls. Depending on configuration, emails may be hidden for logged-out users by default, users may control whether their email is shown, and anonymous or guest-style gameplay may be available for some features.
        </p>
        <p style={proseStyle}>
          Discord avatars may be shown where Discord-linked identities are used, and leaderboard display names may be derived from user profile settings or system defaults.
        </p>
      </LegalSection>

      <LegalSection title="Cookies, Tracking, and Third-Party Services">
        <p style={proseStyle}>
          Open-Trivia is designed around minimal tracking. By default, the service does not represent that it uses advertising technology or optional analytics platforms. Basic website and application functionality may still rely on essential browser storage, session state, or operational logs.
        </p>
        <p style={proseStyle}>
          The service may rely on third parties strictly to operate the product, including hosting/infrastructure providers, SMTP or email-delivery providers if email is configured, and Discord for OAuth and bot interactions.
        </p>
      </LegalSection>

      <LegalSection title="Data Sharing">
        <p style={proseStyle}>
          Personal information is not sold. Information may be disclosed only as needed to operate the service, comply with law, protect users or the platform, support hosting and communications infrastructure, or process Discord-linked functionality.
        </p>
      </LegalSection>

      <LegalSection title="Retention">
        <p style={proseStyle}>
          Information is retained for as long as needed to operate the service, maintain accounts, preserve leaderboards and moderation history, and support backups and restore processes. Deleted or changed data may remain in backups or administrative snapshots for a period of time until those records are rotated or removed.
        </p>
      </LegalSection>

      <LegalSection title="Security Practices">
        <LegalList items={[
          'Passwords are stored as hashes rather than plaintext.',
          'Administrative actions are restricted to authorized roles and recorded in audit logs.',
          'Password reset flows use time-limited tokens.',
          'Backups, exports, and imported data are treated as sensitive operational records.',
          'Reasonable technical and administrative measures are used to protect data, but no system can guarantee absolute security.'
        ]} />
      </LegalSection>

      <LegalSection title="International and User Rights">
        <p style={proseStyle}>
          Users may request access, correction, or deletion of personal information, subject to operational, legal, security, and backup-retention limits. Because Open-Trivia may be used globally, privacy requests are handled in a commercially reasonable manner without promising any jurisdiction-specific statutory workflow unless separately stated by the operator.
        </p>
      </LegalSection>

      <LegalSection title="Children's Privacy">
        <p style={proseStyle}>
          Open-Trivia is not intended for children under 13. If you believe information from a child under that age has been submitted without appropriate authorization, contact the operator so it can be reviewed.
        </p>
      </LegalSection>

      <LegalSection title="Policy Updates">
        <p style={proseStyle}>
          This Privacy Policy may change over time to reflect feature updates, legal changes, or operational adjustments. The current version will be posted on this page with an updated effective date.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
