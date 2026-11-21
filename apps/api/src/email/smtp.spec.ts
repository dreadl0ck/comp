import { createServer, type Socket } from 'node:net';
import nodemailer, { type Transporter } from 'nodemailer';
import { sendViaSmtp } from './smtp';

describe('SMTP transport compatibility', () => {
  it('delivers the auth HTML, envelope and attachment through the owned SMTP sink', async () => {
    const sockets = new Set<Socket>();
    const commands: string[] = [];
    const messages: string[] = [];
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.write('220 fixture.test ESMTP\r\n');
      let pending = '';
      let data: string[] | undefined;
      socket.on('data', (chunk) => {
        pending += chunk.toString();
        let position: number;
        while ((position = pending.indexOf('\r\n')) >= 0) {
          const line = pending.slice(0, position);
          pending = pending.slice(position + 2);
          if (data) {
            if (line !== '.') { data.push(line); continue; }
            messages.push(data.join('\r\n'));
            data = undefined;
            socket.write('250 2.0.0 fixture queued\r\n');
            continue;
          }
          commands.push(line);
          if (/^EHLO /i.test(line)) socket.write('250-fixture.test\r\n250-PIPELINING\r\n250 8BITMIME\r\n');
          else if (line === 'DATA') { data = []; socket.write('354 End with a dot\r\n'); }
          else if (line === 'QUIT') socket.end('221 Bye\r\n');
          else socket.write('250 OK\r\n');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected owned loopback port');
    const previous = { ...process.env };
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(address.port), SMTP_SECURE: 'false', SMTP_FROM: 'sender@fixture.test' });
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const original = nodemailer.createTransport.bind(nodemailer);
    const transports: Transporter[] = [];
    const factory = jest.spyOn(nodemailer, 'createTransport').mockImplementation((...parameters) => {
      const transport = original(...parameters);
      transports.push(transport);
      return transport;
    });
    try {
      const result = await sendViaSmtp({ to: 'recipient@fixture.test', subject: 'Fixture auth message', html: '<p>synthetic sign-in link</p>', attachments: [{ filename: 'fixture.txt', content: 'fixture bytes', contentType: 'text/plain' }] });
      expect(result.id).toMatch(/@fixture\.test>/);
      expect(commands).toContain('MAIL FROM:<sender@fixture.test>');
      expect(commands).toContain('RCPT TO:<recipient@fixture.test>');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('Subject: Fixture auth message');
      expect(messages[0]).toContain('synthetic sign-in link');
      expect(messages[0]).toContain('filename=fixture.txt');
      expect(messages[0]).toContain('Zml4dHVyZSBieXRlcw==');
    } finally {
      for (const transport of transports) transport.close();
      factory.mockRestore();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      process.env = previous;
    }
  });
});
