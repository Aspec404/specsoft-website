window.SPECSOFT_CONFIG = {
    SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
};

window.getSupabaseClient = function () {
    if (!window.supabase) {
        console.error('Supabase JS SDK is not loaded yet. Make sure the CDN script is added before supabase-config.js.');
        return null;
    }

    if (!window.__SPECSOFT_SUPABASE_CLIENT__) {
        window.__SPECSOFT_SUPABASE_CLIENT__ = window.supabase.createClient(
            window.SPECSOFT_CONFIG.SUPABASE_URL,
            window.SPECSOFT_CONFIG.SUPABASE_ANON_KEY
        );
    }

    return window.__SPECSOFT_SUPABASE_CLIENT__;
};
