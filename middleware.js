export const config = {
  // Protect all routes except static assets we might want to bypass (e.g., favicon)
  matcher: ['/((?!favicon.ico).*)'],
};

export default function middleware(request) {
  const authorization = request.headers.get('authorization');
  
  if (authorization) {
    const base64 = authorization.split(' ')[1];
    const credentials = atob(base64);
    const [user, password] = credentials.split(':');
    
    // Read secure environment variables set in Vercel project settings
    const expectedUser = process.env.BASIC_AUTH_USER || 'admin';
    const expectedPassword = process.env.BASIC_AUTH_PASSWORD;
    
    if (expectedPassword && user === expectedUser && password === expectedPassword) {
      return; // Authorized: Allow the request to proceed to the static assets
    }
  }
  
  // Return HTTP 401 Unauthorized challenge to trigger browser login prompt
  return new Response('Authentication Required', {
    status: 401,
    headers: {
      'www-authenticate': 'Basic realm="FocusFlow Secure Area"',
    },
  });
}
