import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

const [manifestPath, appImage, apiImage, portalImage] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sourceDirectory = resolve(dirname(manifestPath));
const run = 'comp-source-'+randomUUID().slice(0, 12);
const created = [];
const checks = [];
const expectedNavigationAborts = [];
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' });
const inter = '2dcd3612039a9aaa2660c0c9edd0f4b982e19d317af5ffe4161c37ddc803b5d0';
const ofl = '5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57';
let browser;

async function port() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}

function runContainer(name, ...args) {
  docker('run', '-d', '--platform=linux/amd64', '--name', name, '--label', 'comp.source.verification='+run, ...args);
  created.push(name);
}

try {
  docker('network', 'create', '--internal', run);
  const probe = `const fs=require('fs'),crypto=require('crypto');
    const kind=process.argv[1];
    if(kind==='api'){
      if(fs.existsSync('/app/node_modules/@inference/tracing'))throw Error('Retired SDK present');
      const code=fs.readFileSync('/app/dist/src/inference-tracing.js','utf8');
      if(code.includes('@inference/tracing')||!code.includes('@opentelemetry/'))throw Error('Wrong tracing adapter');
    }else{
      const dir='/app/apps/'+kind+'/public/fonts/';
      const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      if(hash(dir+'Inter.woff2')!=='${inter}'||hash(dir+'Inter-OFL.txt')!=='${ofl}')throw Error('Font identity mismatch');
      if(fs.readdirSync(dir).some(n=>n.startsWith('GeneralSans')))throw Error('Old fonts remain');
    }
    console.log('artifact verified');`;
  for (const [kind, image] of [['app', appImage], ['api', apiImage], ['portal', portalImage]]) {
    const info = JSON.parse(docker('image', 'inspect', image))[0];
    assert.equal(info.Config.Labels['org.opencontainers.image.revision'], manifest.revision);
    assert.equal(info.Config.Labels['com.amsterdam-technologies.source.sha256'], manifest.sha256);
    assert.equal(docker('run', '--rm', '--platform=linux/amd64', '--network=none', '--entrypoint=node', image, '-e', probe, kind).trim(), 'artifact verified');
    checks.push(kind+' image identity and active assets');
  }

  const fake = `require('http').createServer((req,res)=>{
    if(req.url.startsWith('/api/auth/get-session')){res.setHeader('Content-Type','application/json');res.end('null');return;}
    res.statusCode=404;res.end('Unexpected local fixture request');
  }).listen(3333,'0.0.0.0')`;
  runContainer(run+'-auth', '--network', run, '--network-alias', 'source-auth', '--entrypoint=node', appImage, '-e', fake);
  browser = await chromium.launch({ headless: true });
  for (const [kind, image] of [['app', appImage], ['portal', portalImage]]) {
    const assigned = await port();
    const name = run+'-'+kind;
    runContainer(name, '--network', run,
      '-e', 'HOSTNAME=0.0.0.0', '-e', 'PORT=3000', '-e', 'SKIP_ENV_VALIDATION=true',
      '-e', 'BACKEND_API_URL=http://source-auth:3333',
      '-e', 'DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture',
      '-v', sourceDirectory+':/opt/comp-source:ro', image);
    const proxy = `const http=require('http');http.createServer((req,res)=>{
      const upstream=http.request({hostname:'${name}',port:3000,path:req.url,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
      upstream.on('error',()=>{res.statusCode=502;res.end('Owned upstream not ready');});req.pipe(upstream);
    }).listen(3000,'0.0.0.0')`;
    runContainer(name+'-proxy', '--network', 'bridge', '-p', `127.0.0.1:${assigned}:3000`, '--entrypoint=node', image, '-e', proxy);
    docker('network', 'connect', run, name+'-proxy');
    const origin = `http://127.0.0.1:${assigned}`;
    let ready = false;
    let probeStatus = '';
    for (let n = 0; n < 200; n++) {
      try {
        const response = await fetch(origin+(kind==='app'?'/source':'/auth'));
        ready = response.ok;
        probeStatus = response.status+' '+(ready ? '' : (await response.text()).slice(0, 160));
      } catch (error) { probeStatus = String(error.cause || error); }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready, kind+' owned image did not become ready: '+probeStatus);
    if (kind === 'app') {
      const response = await fetch(origin+'/source/archive');
      assert.equal(response.headers.get('content-type'), 'application/gzip', 'source archive route returned '+response.status+' '+response.headers.get('content-type'));
      assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), manifest.sha256);
      checks.push('app real HTTP source download hash');
    }
    const context = await browser.newContext({ acceptDownloads: true });
    const errors = [];
    const loadedFonts = [];
    const fontTasks = [];
    const sourceResponses = [];
    const navigationAborts = [];
    let sourceNavigation = false;
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        if (url.pathname.startsWith('/_vercel/')) return route.fulfill({ contentType: 'application/javascript', body: '' });
        return route.continue();
      }
      if (url.hostname.endsWith('amsterdam-technologies.com') && url.pathname.startsWith('/api/auth/get-session')) {
        return route.fulfill({ contentType: 'application/json', body: 'null' });
      }
      errors.push('Unexpected browser origin '+url.origin);
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => {
      if (sourceNavigation && error.name === 'AbortError' && error.message === 'Transition was skipped') {
        navigationAborts.push('Source full-document navigation aborted the optional upstream view transition');
        return;
      }
      errors.push(error.name+': '+error.message);
    });
    page.on('response', response => {
      if (response.url().includes('/source')) sourceResponses.push({ url: response.url(), status: response.status(), type: response.headers()['content-type'], disposition: response.headers()['content-disposition'] });
      if (/\.(woff2|ttf)(\?|$)/.test(response.url())) {
        fontTasks.push(response.body().then(body => loadedFonts.push(createHash('sha256').update(body).digest('hex'))).catch(() => {}));
      }
    });
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(origin+'/auth');
      await page.evaluate(() => document.fonts.ready);
      await Promise.all(fontTasks);
      assert(loadedFonts.includes(inter), kind+' Inter not loaded by the built layout');
      const link = page.getByRole('link', { name: 'Modified Comp source (AGPLv3)' });
      assert(await link.isVisible());
      if (kind === 'app') {
        sourceNavigation = true;
        await link.focus();
        await link.press('Enter');
        await page.getByRole('heading', { name: 'Comp modified source' }).waitFor();
        const downloadEvent = page.waitForEvent('download').catch(error => ({ error }));
        const sourceLink = page.getByRole('link', { name: 'Download matching source' });
        assert(await sourceLink.isVisible());
        await sourceLink.focus();
        await sourceLink.press('Enter');
        const download = await downloadEvent;
        if (download.error) throw new Error(JSON.stringify({ width, url: page.url(), checks, sourceResponses, error: download.error.message }));
        const hash = createHash('sha256');
        for await (const chunk of await download.createReadStream()) hash.update(chunk);
        assert.equal(hash.digest('hex'), manifest.sha256);
        sourceNavigation = false;
      } else {
        assert.equal(await link.getAttribute('href'), 'https://compliance.amsterdam-technologies.com/v1/source/page');
      }
      checks.push(kind+' built layout/source link at '+width+'px');
    }
    assert.deepEqual(errors, []);
    if (navigationAborts.length) expectedNavigationAborts.push({ surface: kind, count: navigationAborts.length });
    await context.close();
  }
  console.log(JSON.stringify({ class: 'ui-mocked auth / real built images and source stream', revision: manifest.revision, sourceSHA256: manifest.sha256, checks, count: checks.length, expectedNavigationAborts }));
} catch (error) {
  console.error('Completed release checks:', checks);
  for (const name of created) {
    try { console.error(name, docker('logs', '--tail', '25', name)); } catch {}
  }
  throw error;
} finally {
  await browser?.close();
  for (const name of created.reverse()) { try { docker('rm', '-f', name); } catch {} }
  try { docker('network', 'rm', run); } catch {}
}
