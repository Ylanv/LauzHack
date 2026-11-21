# Déployer AXA Smart Property sur Vercel (compte d'Ylan)

Document pour **Ylan et son Claude Code** : créer un projet Vercel relié à ce dépôt GitHub, avec déploiement automatique à chaque push sur `main`.

> **Règles pour l'agent (Claude Code)**
> - Ne jamais écrire une clé ou un code d'accès dans un fichier du dépôt, un commit, un message de commit ou une sortie affichée. Les valeurs sont demandées à l'humain, et passent uniquement par les variables d'environnement Vercel.
> - Ne rien inventer : si une valeur manque (clé OpenRouter, clé Google), la demander à Ylan.
> - Ne pas déployer `webapp/` (application de youcef, hors de ce déploiement pour l'instant).

## 1. Ce qui est déployé

Une application **FastAPI** (Python 3.13) dans `src/main.py` (objet `app`), détectée automatiquement par Vercel grâce à `requirements.txt` et `.python-version`. Elle sert aussi la page de démo `frontend/index.html` sur `/`.

| Route | Rôle |
|---|---|
| `GET /` | page de démo (formulaire + JSON de sortie) |
| `GET /api/health` | vérifie la configuration (clés présentes, modèles) |
| `GET /api/industries` | valeurs de la liste « type d'industrie » |
| `POST /api/llm-input` | **la pipeline** : renvoie `llm_input.json` (header `X-Access-Code` obligatoire) |
| `POST /api/llm-input?for_llm=true` | même JSON sans les photos (version envoyée au LLM) |

Une analyse dure **15 à 60 s** (limite Vercel : 300 s). L'application n'écrit rien (le cache LLM va dans `/tmp`, volatil).

## 2. Prérequis

1. Le dépôt GitHub est **public** (propriétaire : Ylanv). Sur le plan gratuit de Vercel, un dépôt privé bloque les déploiements dont l'auteur du commit n'est pas le titulaire du compte.
2. Le compte Vercel d'Ylan est connecté à son compte GitHub, avec l'application GitHub « Vercel » autorisée sur le dépôt `LauzHack` (*Only select repositories* → `LauzHack`).
3. Les valeurs secrètes ci-dessous, transmises par arno **en message privé** (jamais dans le dépôt) :
   - clé **OpenRouter** (crédits fournis par AXA, expire le 28 novembre 2026) ;
   - clé **Google Maps** avec **Street View Static API** activée et facturation activée sur le projet Google Cloud.

## 3. Créer le projet

### Option A : tableau de bord (le plus simple)
1. vercel.com → *Add New…* → *Project* → *Import Git Repository* → `Ylanv/LauzHack`.
2. *Root Directory* : `./` (ne pas changer). *Framework Preset* : détecté (FastAPI / Other). Ne rien mettre dans *Build Command* ni *Output Directory*.
3. Ajouter les variables d'environnement (section 4) **avant** de cliquer sur *Deploy*.

### Option B : CLI
```bash
npm i -g vercel
vercel login
vercel link --yes --project axa-smart-property   # crée le projet dans le compte d'Ylan
# puis, pour chaque variable de la section 4, en Production ET Preview :
#   vercel env add NOM production      (la valeur est saisie à l'invite, pas dans la commande)
#   vercel env add NOM preview
vercel deploy --prod --yes
```
Relier ensuite le dépôt : *Settings* → *Git* → *Connect Git Repository* → `Ylanv/LauzHack`.

## 4. Variables d'environnement (Production et Preview)

| Variable | Valeur |
|---|---|
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` |
| `LLM_API_KEY` | clé OpenRouter (**secret**) |
| `MODEL_VISION` | `google/gemini-2.5-flash-lite` |
| `MODEL_EXTRACTION` | `google/gemini-2.5-flash-lite` |
| `GOOGLE_MAPS_API_KEY` | clé Google Street View (**secret**) |
| `ACCESS_CODE` | code d'accès choisi par Ylan (**secret**, ≥ 12 caractères). Il protège les crédits : sans lui, n'importe qui peut lancer des analyses payantes |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | optionnel (cache LLM partagé entre instances) |

Ne pas définir `VERCEL`, `ON_VERCEL` ni d'autres variables : Vercel les fournit.

## 5. Vérifier le déploiement

Remplacer `<URL>` par l'URL du projet.

```bash
# 1. configuration (aucune valeur secrète n'est renvoyée)
curl -s <URL>/api/health
#   attendu : "llm_configured": true, "streetview_configured": true, "access_code_required": true

# 2. sécurité : sans code → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST <URL>/api/llm-input -H "Content-Type: application/json" \
  -d '{"client_name":"x","company_legal_name":"CMDS SA","address":"Rue du Champ-Blanchod 7, 1228 Plan-les-Ouates","industry_type":"metalworking"}'

# 3. analyse réelle (remplacer <CODE> par l'ACCESS_CODE ; ~20 s)
curl -s -X POST "<URL>/api/llm-input?for_llm=true" -H "Content-Type: application/json" -H "X-Access-Code: <CODE>" \
  -d '{"client_name":"Marie Dupont","company_legal_name":"CMDS SA","address":"Rue du Champ-Blanchod 7, 1228 Plan-les-Ouates","industry_type":"metalworking"}'
```

Résultat attendu pour CMDS SA : **19 features sur 19** (`feature_coverage_before_llm.all`), 5 photos, `evidence.public_data.geneva.source` = `sitg_extract (...)`, `evidence.facade.status` = `ok`, `evidence.website.status` = `ok`.

Test d'un push par un autre membre : après un commit d'un autre auteur sur `main`, vérifier que le déploiement automatique part (le plan gratuit peut bloquer les commits de non-membres sur un dépôt privé).

## 6. Points d'attention

- **Le serveur SITG de Genève (`vector.sitg.ge.ch`) coupe les connexions venant des clouds (Vercel/AWS).** C'est pour ça que les données genevoises sont **embarquées** dans `data/sitg_ge_extract.json.gz` (3 Mo, 7 077 bâtiments d'activité). Ce fichier **doit rester dans le dépôt**. Pour le régénérer (depuis un poste non bloqué, pas depuis Vercel) : `python scripts/build_sitg_extract.py`.
- **`webapp/`** : l'intégration Git clone tout le dépôt. Si le build échoue à cause de `webapp/package.json`, ne pas créer de `vercel.json` à la racine avec un framework ; demander à arno. Le fichier `.vercelignore` exclut `webapp/` pour la CLI, mais Vercel ne l'applique peut-être pas aux déploiements Git.
- **Région** : par défaut Vercel choisit une région des États-Unis. Pour moins de latence vers les services suisses, *Settings* → *Functions* → *Function Region* → Frankfurt (`fra1`). Optionnel.
- **Le code Python qui interroge SITG peut échouer en silence** : si `evidence.public_data.geneva.status` vaut `error` ou si `source` vaut `sitg_live`, l'extrait n'a pas été trouvé ou le bâtiment n'est pas dedans.

## 7. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `401` sur `/api/llm-input` | `X-Access-Code` absent ou différent de `ACCESS_CODE` | Vérifier la variable et le header |
| `facade.status = error`, `note` contient `REQUEST_DENIED ... Billing` | Facturation non activée sur le projet Google Cloud | Activer la facturation et l'API Street View Static |
| `website`/`facade` en `error` avec `429` | Limite de débit du fournisseur LLM (appels en parallèle) | Les appels sont relancés 2 fois automatiquement ; réessayer. Si ça persiste, attendre une minute |
| `422` « No company registered under the exact name » | Nom de société inexact | Utiliser la raison sociale exacte du registre du commerce (ex. `CMDS SA`) |
| `422` « Out of scope » | Bâtiment hors canton de Genève, logement ou immeuble mixte | Comportement voulu : seules les PME avec leur propre bâtiment d'activité à Genève sont traitées |
| `503` | Un service public ne répond pas | Réessayer |
| Build qui échoue sur une dépendance | Version Python ou paquet | Vérifier `.python-version` (3.13) et `requirements.txt` ; lire les logs avec `vercel inspect <url> --logs` |
| Clé OpenRouter épuisée | Crédits de l'équipe consommés | Voir l'usage : `GET https://openrouter.ai/api/v1/key` (en-tête `Authorization: Bearer <clé>`) |

## 8. Coûts

Environ **CHF 0.0006 par analyse** (3 appels Gemini 2.5 Flash-Lite, coût réel renvoyé par OpenRouter dans `metrics.cost_usd`) plus une photo Street View (10 000 gratuites par mois). Dans `metrics.tool_calls`, chaque appel LLM indique le modèle, les tokens et le coût.
