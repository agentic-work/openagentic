/**
 * Email Service - Sends notification emails via SMTP
 *
 * Uses Nodemailer with configurable SMTP providers.
 * Default: Uses Brevo (Sendinblue) free tier or Gmail SMTP.
 */

import nodemailer from 'nodemailer';

// Simple logger interface that works with both pino and console
interface SimpleLogger {
  info: (obj: any, msg?: string) => void;
  warn: (obj: any, msg?: string) => void;
  error: (obj: any, msg?: string) => void;
  debug?: (obj: any, msg?: string) => void;
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
}

export interface AccessRequestData {
  email: string;
  name?: string;
  picture?: string;
  googleUserId: string;
  hostedDomain?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  headers: Record<string, string>;
  rawPayload?: any;
}

/**
 * Email Service for sending notifications
 */
export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private config: EmailConfig;
  private logger: SimpleLogger;
  private enabled: boolean = false;

  constructor(logger?: SimpleLogger) {
    // Wrap console to match pino-style logging
    this.logger = logger || {
      info: (obj: any, msg?: string) => console.log('[INFO]', msg || '', obj),
      warn: (obj: any, msg?: string) => console.warn('[WARN]', msg || '', obj),
      error: (obj: any, msg?: string) => console.error('[ERROR]', msg || '', obj),
      debug: (obj: any, msg?: string) => console.debug('[DEBUG]', msg || '', obj),
    };

    // Default to Brevo (Sendinblue) free tier SMTP
    // Free tier: 300 emails/day
    this.config = {
      host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
      },
      from: process.env.SMTP_FROM || 'noreply@openagentic.io'
    };

    // Only enable if SMTP credentials are configured
    if (this.config.auth.user && this.config.auth.pass) {
      this.enabled = true;
      this.initializeTransporter();
    } else {
      this.logger.warn('[EMAIL-SERVICE] SMTP credentials not configured - email notifications disabled');
      this.logger.info('[EMAIL-SERVICE] To enable: set SMTP_HOST, SMTP_USER, SMTP_PASS environment variables');
    }
  }

  private initializeTransporter(): void {
    try {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: this.config.auth
      });

      this.logger.info({
        host: this.config.host,
        port: this.config.port,
        from: this.config.from
      }, '[EMAIL-SERVICE] Initialized email transporter');
    } catch (error: any) {
      this.logger.error({ error: error.message }, '[EMAIL-SERVICE] Failed to initialize transporter');
      this.enabled = false;
    }
  }

  /**
   * Send access request notification to admin
   */
  async sendAccessRequestNotification(data: AccessRequestData): Promise<boolean> {
    const to = process.env.ACCESS_REQUEST_EMAIL || 'hello@openagentic.io';

    if (!this.enabled || !this.transporter) {
      this.logger.warn({
        email: data.email,
        to
      }, '[EMAIL-SERVICE] Email disabled - would have sent access request notification');

      // Log the details even if email is disabled
      this.logger.info({
        accessRequest: {
          email: data.email,
          name: data.name,
          googleUserId: data.googleUserId,
          hostedDomain: data.hostedDomain,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          timestamp: data.timestamp
        }
      }, '[EMAIL-SERVICE] Access request details (email not sent)');

      return false;
    }

    const subject = `[OpenAgentic] New Access Request from ${data.email}`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1a1a2e; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f8f9fa; padding: 20px; border-radius: 0 0 8px 8px; }
    .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    .info-table td { padding: 10px; border-bottom: 1px solid #ddd; }
    .info-table td:first-child { font-weight: bold; width: 30%; }
    .avatar { border-radius: 50%; width: 64px; height: 64px; }
    .footer { margin-top: 20px; font-size: 12px; color: #666; }
    .action-needed { background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>🔐 New Access Request</h2>
      <p>Someone is requesting access to OpenAgentic</p>
    </div>
    <div class="content">
      <div class="action-needed">
        <strong>Action Required:</strong> Review this access request and add the user to the allowed list if approved.
      </div>

      ${data.picture ? `<img src="${data.picture}" alt="Profile" class="avatar" />` : ''}

      <h3>User Information</h3>
      <table class="info-table">
        <tr><td>Email</td><td><strong>${data.email}</strong></td></tr>
        <tr><td>Name</td><td>${data.name || 'Not provided'}</td></tr>
        <tr><td>Google User ID</td><td>${data.googleUserId}</td></tr>
        <tr><td>Google Workspace Domain</td><td>${data.hostedDomain || 'Personal Gmail account'}</td></tr>
      </table>

      <h3>Request Details</h3>
      <table class="info-table">
        <tr><td>Timestamp</td><td>${data.timestamp.toISOString()}</td></tr>
        <tr><td>IP Address</td><td><strong>${data.ipAddress}</strong></td></tr>
        <tr><td>User Agent</td><td style="font-size: 11px; word-break: break-all;">${data.userAgent}</td></tr>
      </table>

      <h3>Request Headers</h3>
      <table class="info-table" style="font-size: 11px;">
        ${Object.entries(data.headers)
          .filter(([key]) => !['authorization', 'cookie'].includes(key.toLowerCase()))
          .map(([key, value]) => `<tr><td>${key}</td><td style="word-break: break-all;">${value}</td></tr>`)
          .join('')}
      </table>

      <div class="footer">
        <p>To approve this user, add their email to the <code>GOOGLE_ALLOWED_USERS</code> environment variable.</p>
        <p>To grant admin access, add their email to <code>GOOGLE_ADMIN_EMAILS</code>.</p>
        <hr>
        <p>This email was sent by OpenAgentic Access Control System</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

    const textBody = `
New Access Request for OpenAgentic
===================================

User Information:
- Email: ${data.email}
- Name: ${data.name || 'Not provided'}
- Google User ID: ${data.googleUserId}
- Google Workspace Domain: ${data.hostedDomain || 'Personal Gmail account'}

Request Details:
- Timestamp: ${data.timestamp.toISOString()}
- IP Address: ${data.ipAddress}
- User Agent: ${data.userAgent}

Request Headers:
${Object.entries(data.headers)
  .filter(([key]) => !['authorization', 'cookie'].includes(key.toLowerCase()))
  .map(([key, value]) => `- ${key}: ${value}`)
  .join('\n')}

---
To approve this user, add their email to GOOGLE_ALLOWED_USERS environment variable.
To grant admin access, add their email to GOOGLE_ADMIN_EMAILS.
`;

    try {
      const result = await this.transporter.sendMail({
        from: this.config.from,
        to,
        subject,
        text: textBody,
        html: htmlBody
      });

      this.logger.info({
        messageId: result.messageId,
        to,
        email: data.email
      }, '[EMAIL-SERVICE] Access request notification sent successfully');

      return true;
    } catch (error: any) {
      this.logger.error({
        error: error.message,
        to,
        email: data.email
      }, '[EMAIL-SERVICE] Failed to send access request notification');

      return false;
    }
  }

  /**
   * Verify SMTP connection is working
   */
  async verify(): Promise<boolean> {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      this.logger.info('[EMAIL-SERVICE] SMTP connection verified successfully');
      return true;
    } catch (error: any) {
      this.logger.error({ error: error.message }, '[EMAIL-SERVICE] SMTP verification failed');
      return false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
let emailServiceInstance: EmailService | null = null;

export function getEmailService(logger?: SimpleLogger): EmailService {
  if (!emailServiceInstance) {
    emailServiceInstance = new EmailService(logger);
  }
  return emailServiceInstance;
}

export default EmailService;
