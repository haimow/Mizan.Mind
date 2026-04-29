// Netlify Function — Google OAuth redirect interceptor
// GoTrue /authorize zincirini takip eder, Google OAuth URL'sini bulur,
// prompt=select_account ekler. redirect_to=/app/ ile token app'e düşer.

export default async function handler(req, context) {
  const siteUrl = process.env.URL || 'https://mizanmind.netlify.app';
  const redirectTo = encodeURIComponent(`${siteUrl}/app/`);
  const gotrueStart = `${siteUrl}/.netlify/identity/authorize?provider=google&redirect_to=${redirectTo}`;

  try {
    // GoTrue birden fazla redirect yapabilir — Google URL'sini bulana kadar takip et
    let currentUrl = gotrueStart;
    let googleOAuthUrl = null;

    for (let i = 0; i < 6; i++) {
      const res = await fetch(currentUrl, { redirect: 'manual' });
      const location = res.headers.get('location');

      if (!location) break;

      if (location.includes('accounts.google.com')) {
        googleOAuthUrl = location;
        break;
      }

      // Göreceli URL'yi mutlak yap
      currentUrl = location.startsWith('http')
        ? location
        : `${siteUrl}${location.startsWith('/') ? '' : '/'}${location}`;
    }

    if (googleOAuthUrl) {
      const url = new URL(googleOAuthUrl);
      url.searchParams.set('prompt', 'select_account');
      return new Response(null, {
        status: 302,
        headers: {
          'Location': url.toString(),
          'Cache-Control': 'no-store, no-cache'
        }
      });
    }

    // Fallback
    return new Response(null, {
      status: 302,
      headers: { 'Location': `${gotrueStart}&prompt=select_account` }
    });
  } catch {
    return new Response(null, {
      status: 302,
      headers: { 'Location': `${gotrueStart}&prompt=select_account` }
    });
  }
}
