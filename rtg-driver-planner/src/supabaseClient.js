// ==========================================
// RTG DRIVER PLANNER — Client Supabase
// URL et clé "publishable" (anciennement "anon public") : destinées à être
// visibles côté navigateur, la protection réelle des données vient des
// politiques RLS (voir supabase/schema.sql), pas du secret de cette clé.
// ==========================================

const RTG_SUPABASE_URL = "https://rqhjabwqjxlmjdicgyqy.supabase.co";
const RTG_SUPABASE_ANON_KEY = "sb_publishable_spgJgzxDZP5TMhwHjo2BWw_Oo94bccm";

// Client principal : conserve la session de l'utilisateur connecté.
const sb = supabase.createClient(RTG_SUPABASE_URL, RTG_SUPABASE_ANON_KEY);

// Client secondaire, sans persistance de session : utilisé uniquement pour
// créer un compte AU NOM D'UN AUTRE utilisateur (RTGStore.addUser) sans
// remplacer la session de l'administrateur actuellement connecté — un appel
// à supabase.auth.signUp() sur le client principal basculerait sinon la
// session courante vers le compte fraîchement créé.
const sbAdmin = supabase.createClient(RTG_SUPABASE_URL, RTG_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
