# Trombinoscope HelloAsso

Outil Windows pour générer le trombinoscope des adhérents d'une association à partir de l'API HelloAsso : photo, nom, prénom et date d'adhésion, à imprimer en A4 ou à enregistrer en PDF.

## Installation

1. Ouvrez la page **[Releases](../../releases/latest)** et téléchargez `Trombinoscope.exe`.
2. Double-cliquez dessus. Si Windows affiche « SmartScreen a protégé votre PC » : *Informations complémentaires* puis *Exécuter quand même* (l'exe n'est pas signé).
3. Le navigateur s'ouvre sur l'outil. Au premier lancement, renseignez dans **Réglages** :
   - le **Client ID** et le **Client Secret** (HelloAsso : *Mon compte > Intégrations et API*) ;
   - le **slug de l'organisation** (dans l'URL de votre page HelloAsso).
4. Cliquez sur **Tester la connexion**, puis **Enregistrer**. Vous n'aurez plus à le refaire.

### Sur Mac

1. Dans les **[Releases](../../releases/latest)**, téléchargez `Trombinoscope-Mac-AppleSilicon.zip` (Mac M1 à M4) ou `Trombinoscope-Mac-Intel.zip` (Mac plus anciens). En cas de doute : menu  > *À propos de ce Mac*.
2. Décompressez, puis double-cliquez sur `Lancer-Trombinoscope.command`.
3. Au premier lancement, macOS peut refuser car l'application n'est pas signée : *clic droit > Ouvrir*, ou *Réglages Système > Confidentialité et sécurité > Ouvrir quand même*.
4. Suite identique à Windows (Réglages, etc.). Les réglages sont dans `~/Library/Application Support/Trombinoscope-HelloAsso/`.

Gardez la fenêtre Terminal ouverte pendant l'utilisation ; fermez-la pour quitter.

## Utilisation

- Cochez les adhérents à inclure (clic sur la carte). **Sélectionner les nouveaux** coche ceux jamais imprimés.
- Cliquez sur **Trombinoscope (n)** pour imprimer ou exporter en PDF.
- Après l'impression, l'outil propose de marquer ces adhérents comme imprimés.

Les réglages et la liste des « déjà imprimés » sont stockés dans `%APPDATA%\Trombinoscope-HelloAsso\` sur votre ordinateur. Rien n'est envoyé ailleurs qu'à HelloAsso.

## Pour les développeurs

```
npm install
npm start          # lance le serveur local (http://localhost:3737)
npm run build      # produit dist/Trombinoscope.exe
```

Publier une nouvelle version : `git tag v1.0.1 && git push origin v1.0.1`. GitHub Actions compile les versions Windows et Mac et les attache à la Release.
