import nodemailer from 'nodemailer'

export function createMailSender({ smtpUrl = process.env.SMTP_URL, from = process.env.MAIL_FROM } = {}) {
  let transport
  return async function sendMail({ to, subject, text }) {
    if (!smtpUrl || !from) throw Object.assign(new Error('邮件服务尚未配置'), { status: 503 })
    transport ||= nodemailer.createTransport(smtpUrl)
    await transport.sendMail({ from, to, subject, text })
  }
}

export const sendMail = createMailSender()
