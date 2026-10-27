// @vitest-environment node
import { expect, it, vi } from 'vitest'
const sender = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: sender.send }) } }))
import { createMailSender } from '../server/mail.js'
import { metricsSnapshot } from '../server/telemetry.js'

it('records failed and successful mail deliveries without logging addresses, SMTP credentials or token bodies', async () => {
  const before = metricsSnapshot(), log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const send = createMailSender({ smtpUrl: 'smtp://secret-password@localhost', from: 'operator@example.com' })
    sender.send.mockRejectedValueOnce(new Error('private reset token smtp-password'))
    await expect(send({ to: 'private@example.com', subject: 'Reset', text: 'private-token' })).rejects.toThrow()
    expect(metricsSnapshot().mail_failure).toBe(before.mail_failure + 1)
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|password|operator@/)
    sender.send.mockResolvedValueOnce({})
    await send({ to: 'private@example.com', subject: 'Verify', text: 'private-token' })
    expect(metricsSnapshot().mail_success).toBe(before.mail_success + 1)
  } finally { log.mockRestore() }
})
