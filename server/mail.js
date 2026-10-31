import nodemailer from 'nodemailer'
import { incrementMetric } from './telemetry.js'

export function createMailSender({ smtpUrl = process.env.SMTP_URL, from = process.env.MAIL_FROM } = {}) {
  let transport
  return async function sendMail({ to, subject, text }) {
    try {
      if (!smtpUrl || !from) throw Object.assign(new Error('邮件服务尚未配置'), { status: 503 })
      transport ||= nodemailer.createTransport(smtpUrl)
      await transport.sendMail({ from, to, subject, text })
      incrementMetric('mail_success')
    } catch (error) {
      incrementMetric('mail_failure')
      console.error(JSON.stringify({ event: 'mail_delivery_failed', code: 'MAIL_DELIVERY_FAILED' }))
      throw error
    }
  }
}

export const sendMail = createMailSender()
