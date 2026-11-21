const localFetch = globalThis.fetch;
type Options = {
  data?: unknown;
  headers?: Record<string, string>;
  maxRedirects?: number;
};

// Separate cookie jars, using actual Set-Cookie headers from the real auth handler.
export class LocalClient {
  private cookies = new Map<string, string>();
  constructor(private origin: string) {}
  get(path: string, options: Options = {}) {
    return this.send({ path, method: 'GET', options });
  }
  post(path: string, options: Options = {}) {
    return this.send({ path, method: 'POST', options });
  }
  async dispose() {
    this.cookies.clear();
  }
  async storageState() {
    return {
      cookies: [...this.cookies].map(([name, value]) => ({ name, value })),
    };
  }
  private async send({
    path,
    method,
    options,
  }: {
    path: string;
    method: string;
    options: Options;
  }) {
    let url = new URL(path, this.origin);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (url.origin !== this.origin)
        throw new Error('Unexpected HTTP client origin');
      const response = await localFetch(url, {
        method,
        redirect: 'manual',
        headers: {
          origin: this.origin,
          'content-type': 'application/json',
          cookie: [...this.cookies]
            .map(([key, value]) => `${key}=${value}`)
            .join('; '),
          ...options.headers,
        },
        body:
          method === 'POST' ? JSON.stringify(options.data ?? {}) : undefined,
      });
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(';')[0];
        const split = pair.indexOf('=');
        const name = pair.slice(0, split);
        const value = pair.slice(split + 1);
        if (!value || /max-age=0/i.test(header)) this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
      const location = response.headers.get('location');
      if (
        response.status >= 300 &&
        response.status < 400 &&
        location &&
        options.maxRedirects !== 0
      ) {
        url = new URL(location, url);
        method = 'GET';
        continue;
      }
      return {
        status: () => response.status,
        json: () => response.json(),
        headers: () => Object.fromEntries(response.headers),
      };
    }
    throw new Error('Too many local redirects');
  }
}
