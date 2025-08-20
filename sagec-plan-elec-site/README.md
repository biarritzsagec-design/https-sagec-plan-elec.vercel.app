# Sagec Plan Élec — Site statique
Ce dossier contient un site **prêt à déployer** qui héberge l'éditeur de plans électriques.

## Démarrer en local
Ouvrez simplement `index.html` dans votre navigateur.

## Déployer (Netlify / Vercel / hébergeur classique)
- Déposez tout le dossier tel quel.
- URL finale conseillée : `https://votredomaine/plan/elec`

### Vercel (rapide)
1. Créez un compte sur vercel.com
2. Nouveau projet → **Importer** ce dossier
3. Build command: _Aucune_ (site statique)
4. Output directory: `/` (racine)
5. Déployez

### Nom de domaine
- Achetez un domaine (ex. `sagec.fr`) chez un registrar (OVH, Gandi, Cloudflare…)
- Pointez le domaine vers votre hébergeur (en suivant l’assistant)
- Configurez éventuellement un sous-chemin `/Sagec/Plan/Elec` via réécriture/redirect si nécessaire.

## Limites & évolutions
- Tailwind est chargé via CDN (pratique pour un prototype, remplaçable par un build).
- Si vous voulez une version **buildée** (sans Babel dans le navigateur), je peux fournir un projet Vite/Next.js + Tailwind prêt à déployer.
