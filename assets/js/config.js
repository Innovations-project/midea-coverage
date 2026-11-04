/* ===========================================================================
   Dashboard configuration
   ---------------------------------------------------------------------------
   This is the file to edit for day-to-day changes — no build step required.

   auth.required
     true  → visitors must sign in before the dashboard appears.
     false → the dashboard opens straight away.

   By default the gate switches itself on for hosted copies (anything served
   over http/https from a real host, such as GitHub Pages) and stays off when
   the page is opened from disk (file://) or from localhost. That keeps the
   public site protected without getting in the way of double-clicking
   index.html on your own laptop.

   supabaseUrl / supabaseAnonKey are the project URL and the publishable
   ("anon") key — both are public by design and are sent to every browser.
   Never put a service-role key in this file.

   Note: data/dataset.js is a public file. The sign-in gate keeps casual
   visitors away from the UI, but anyone with the URL can read the data file
   itself. For real protection, host the site behind an access layer
   (Cloudflare Access, Vercel/Netlify password protection, or a private repo).
   =========================================================================== */
(function () {
  var host = location.hostname;
  var localHost = !host || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  var hosted = location.protocol !== 'file:' && !localHost;

  window.APP_CONFIG = {
    auth: {
      required: hosted,
      supabaseUrl: 'https://tuvffrokkjvlbnuaeyuu.supabase.co',      // e.g. 'https://your-project.supabase.co'
      supabaseAnonKey: 'sb_publishable_ldWPuopytzi3LYW4NbiQEw_9LGw8EFs'   // the publishable / anon key from Supabase → Settings → API
    },

    labels: {
      proShop: 'ProShop',
      hvacss: 'HVAC Solution'
    },

    tables: {
      shopPageSize: 25,
      masterPageSize: 50
    }
  };
})();
