import worker from './index.js';

export default {
  async fetch(request, env, ctx) {
    const response = await worker.fetch(request, env, ctx);

    if (request.method === 'GET' && new URL(request.url).pathname === '/auth' && response.headers.get('content-type')?.includes('text/html')) {
      const source = await response.text();
      const enhanced = source.replace(
        "else{sm('Verification complete. You may close this window and return to Discord.','ok');vb.style.display='none'}",
        "else{sm('Verification complete. Returning to Discord...','ok');vb.style.display='none';var rb=document.createElement('button');rb.className='btn';rb.textContent='Return to Discord';rb.style.marginTop='12px';rb.onclick=function(){window.location.href='discord://'};vb.parentNode.insertBefore(rb,vb.nextSibling);setTimeout(function(){window.location.href='discord://'},700)}"
      );
      return new Response(enhanced, { status: response.status, headers: response.headers });
    }

    return response;
  },
};
