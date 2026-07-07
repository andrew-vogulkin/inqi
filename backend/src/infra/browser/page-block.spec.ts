import { detectPageBlock } from './page-block';

describe('detectPageBlock', () => {
  it('flags a 4xx/5xx response as blocked', () => {
    expect(detectPageBlock({ status: 403, title: 'Just a moment...', text: 'Enable JavaScript and cookies to continue' }))
      .toEqual({ blocked: true, reason: 'http 403' });
    expect(detectPageBlock({ status: 503, title: '', text: '' }).blocked).toBe(true);
  });

  it('flags a Cloudflare challenge on a 200 by its title/short body', () => {
    const b = detectPageBlock({ status: 200, title: 'Just a moment...', text: 'Enable JavaScript and cookies to continue' });
    expect(b.blocked).toBe(true);
    expect(b.reason).toMatch(/bot challenge/i);
  });

  it('flags a redirect to a login/sign-in path', () => {
    const b = detectPageBlock({ status: 200, finalUrl: 'https://www.facebook.com/login/?next=%2Fx', title: 'Log in to Facebook', text: 'You must log in to continue.' });
    expect(b.blocked).toBe(true);
    expect(b.reason).toMatch(/login wall/i);
  });

  it('does NOT flag a real, content-rich page that merely links to a login', () => {
    const body = 'Welcome to Hillcreek Gardens Tagaytay. '.repeat(40) + ' Log in to continue to your account portal.';
    expect(detectPageBlock({ status: 200, finalUrl: 'https://hillcreekgardenstagaytay.com/', title: 'Hillcreek Gardens Tagaytay | Events Place', text: body }))
      .toEqual({ blocked: false });
  });

  it('does not flag a normal 200 page', () => {
    expect(detectPageBlock({ status: 200, finalUrl: 'https://x.example/', title: 'Menu & Prices', text: 'Our wedding package starts at ...' }).blocked).toBe(false);
  });
});
