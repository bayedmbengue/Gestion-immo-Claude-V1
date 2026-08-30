const SUPABASE_URL = 'https://mnaaalblclxvxgyrbbuf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uYWFhbGJsY2x4dnhneXJiYnVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwOTA1NTIsImV4cCI6MjEwMzY2NjU1Mn0.TQCT3OK90jsMxifxP7zu8DiwECjzKfFZUVpcl8SLz6g';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function migrateDataToSupabase() {
    console.log("Starting migration to Supabase...");
    
    // Check if user is authenticated in Supabase
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        alert("Vous devez être connecté via Supabase pour migrer les données ! (Nous mettrons en place la connexion plus tard)");
        return;
    }

    try {
        // Migrate Immobilisations
        if (DB.immobilisations && DB.immobilisations.length > 0) {
            console.log("Migrating immobilisations...");
            const immoData = DB.immobilisations.map(im => ({
                code: im.code,
                designation: im.designation,
                categorie: im.categorie,
                nature: im.nature || null,
                financement: im.financement || null,
                vo: im.vo,
                fournisseur: im.fournisseur || null,
                affectation: im.affectation || null,
                methode: im.methode || 'lin',
                duree: im.duree,
                taux: im.taux,
                date_acq: im.dateAcq,
                cal: im.cal || 360,
                statut: im.statut || 'actif',
                ci: im.ci || null,
                ca: im.ca || null
            }));
            
            const { error } = await supabaseClient.from('immobilisations').upsert(immoData, { onConflict: 'code' });
            if (error) throw error;
        }

        alert("Migration terminée avec succès !");
    } catch (err) {
        console.error("Erreur de migration :", err);
        alert("Erreur lors de la migration : " + err.message);
    }
}
