// Isi dari Supabase → Project Settings → API.
// Anon key memang publik (aman dipasang di frontend) karena data dilindungi
// Row Level Security. JANGAN pernah memasukkan service_role key di sini.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://GANTI-PROJECT-REF.supabase.co',
  SUPABASE_ANON_KEY: 'GANTI-DENGAN-ANON-KEY'
};
