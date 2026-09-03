import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchPluginReleasePolicy } from '../clients.js';

test('OpenClaw reports its host and installed version when reading release policy', async () => {
  const originalFetch = globalThis.fetch;
  let observedHeaders: Headers | null = null;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    observedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({
      _meta: {
        hirey_plugin: {
          host: 'openclaw',
          latest: '1.0.74',
          minimum_supported: '1.0.73',
          update_required: false,
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const policy = await fetchPluginReleasePolicy('https://hi.hirey.ai/');
    assert.equal(observedHeaders?.get('x-hirey-plugin-host'), 'openclaw');
    assert.equal(observedHeaders?.get('x-hirey-plugin-version'), '1.0.74');
    assert.equal(policy?.host, 'openclaw');
    assert.equal(policy?.update_required, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
