'use client';

/* Last-resort error screen (the root layout itself failed) – plain HTML, no providers available. */
export default function GlobalError({ reset }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0, background: '#f6f2ea' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h2>Something went wrong / कुछ गड़बड़ हो गई</h2>
          <p>Your data is safe. Please reload the page.</p>
          <button type="button" onClick={() => reset()} style={{ padding: '8px 20px', fontSize: 16, cursor: 'pointer' }}>Reload / पुनः लोड करें</button>
        </div>
      </body>
    </html>
  );
}
