# Trombinoscope HelloAsso

Outil (Windows, Mac et Android) pour générer le trombinoscope des adhérents d'une association à partir de l'API HelloAsso : photo, nom, prénom et date d'adhésion, à imprimer en A4 ou à enregistrer en PDF.

## Installation

1. Ouvrez la page **[Releases](../../releases/latest)** et téléchargez `Trombinoscope.exe`.
2. Double-cliquez dessus. Si Windows affiche « SmartScreen a protégé votre PC » : *Informations complémentaires* puis *Exécuter quand même* (l'exe n'est pas signé).
3. Le navigateur s'ouvre sur l'outil. Au premier lancement, renseignez dans **Réglages** :
   - le **Client ID** et le **Client Secret** (HelloAsso : *Mon compte > Intégrations et API*) ;
   - le **slug de l'organisation** (dans l'URL de votre page HelloAsso).
4. Cliquez sur **Tester la connexion**, puis **Enregistrer**. Vous n'aurez plus à le refaire.

### Sur Mac

**Méthode conseillée (sans blocage de sécurité)** : ouvrez l'application *Terminal* (Launchpad > Autres > Terminal), collez cette ligne puis appuyez sur Entrée :

```
curl -fsSL https://raw.githubusercontent.com/Nerdyeu/Hello-Asso-Tool/main/install-mac.sh | bash
```

L'outil s'installe dans *Applications* (bonne version Apple Silicon ou Intel choisie automatiquement) et s'ouvre. Ensuite, lancez **Trombinoscope** depuis le Launchpad ou le dossier Applications comme n'importe quelle application. Pour mettre à jour, recollez la même ligne.

**Méthode manuelle** :

1. Dans les **[Releases](../../releases/latest)**, téléchargez `Trombinoscope-Mac-AppleSilicon.zip` (Mac M1 à M4) ou `Trombinoscope-Mac-Intel.zip` (Mac plus anciens). En cas de doute : menu  > *À propos de ce Mac*.
2. Décompressez le zip (double-clic) et double-cliquez sur `Trombinoscope`. macOS refuse de l'ouvrir car l'application n'est pas signée par Apple : cliquez sur **Terminé**, puis allez dans *Réglages Système > Confidentialité et sécurité*, tout en bas, et cliquez sur **Ouvrir quand même** (mot de passe demandé). Relancez l'application et confirmez. Ce n'est nécessaire qu'au premier lancement.

Dans les deux cas :

- Le navigateur s'ouvre tout seul sur l'outil. Utilisez le bouton **Quitter** de la page pour fermer l'outil (il se ferme aussi tout seul 30 minutes après la fermeture de l'onglet). Si la page indique que l'application est fermée, relancez-la et rechargez la page.
- Suite identique à Windows. Les réglages sont dans `~/Library/Application Support/Trombinoscope-HelloAsso/`.

### Sur Android

1. Sur le téléphone ou la tablette, ouvrez les **[Releases](../../releases/latest)** et téléchargez `Trombinoscope-Android.apk`.
2. Ouvrez le fichier téléchargé. Android demande d'autoriser l'installation d'applications depuis votre navigateur (ou « sources inconnues ») : acceptez, puis **Installer**. Si Play Protect affiche un avertissement (appli inconnue), choisissez *Installer quand même*.
3. Ouvrez **Trombinoscope**. Suite identique à Windows (Réglages, Tester la connexion, Enregistrer).
4. Le bouton **Trombinoscope (n)** ouvre la fenêtre d'impression d'Android : choisissez une imprimante ou **Enregistrer au format PDF**.
5. Mise à jour : téléchargez et installez le nouvel APK par-dessus l'ancien, les réglages sont conservés.

Les réglages restent dans la mémoire privée de l'appli (ils sont effacés si on la désinstalle).

## Utilisation

- Seules les adhésions (pas les dons) des adhérents ayant payé **100, 110, 160 ou 170 €** sont retenus (modifiable dans **Réglages > Montants payés**). Les doublons sont fusionnés, et la fiche avec photo est toujours conservée.
- Cochez les adhérents à inclure (clic sur la carte). Le bouton **Retirer** d'une carte la masque du trombinoscope (uniquement dans l'outil, rien n'est supprimé chez HelloAsso) ; **Retirés** permet de la remettre. **Sélectionner les nouveaux** coche ceux jamais imprimés.
- Cliquez sur **Trombinoscope (n)** pour imprimer ou exporter en PDF : 20 adhérents maximum par page A4 (5 colonnes x 4 lignes).
- Après l'impression, l'outil propose de marquer ces adhérents comme imprimés.

Les réglages et la liste des « déjà imprimés » sont stockés dans `%APPDATA%\Trombinoscope-HelloAsso\` sur votre ordinateur. Rien n'est envoyé ailleurs qu'à HelloAsso.

## Pour les développeurs

```
npm install
npm start          # lance le serveur local (http://localhost:3737)
npm run build      # produit dist/Trombinoscope.exe
npm test           # tests de sécurité du serveur local
```

La logique HelloAsso (lecture des adhésions, filtres, doublons) est dans `public/core.js`, partagée par le serveur (`server.js`) et l'appli Android. Dans l'appli Android, `public/mobile.js` remplace le serveur local.

Appli Android (Capacitor, dossier `mobile/`, Node 22 et JDK 21 nécessaires) :

```
cd mobile
npm install
npm run sync                                   # copie ../public dans l'appli Android
cd android && ./gradlew assembleDebug          # APK de test : app/build/outputs/apk/debug/
```

L'APK publié est signé par GitHub Actions avec la clé stockée dans les secrets du dépôt `ANDROID_KEYSTORE_BASE64` (fichier `.p12` en base64) et `ANDROID_KEYSTORE_PASSWORD`. **Gardez une copie de cette clé** : sans elle, Android refusera d'installer les mises à jour par-dessus l'appli existante.

Publier une nouvelle version : `git tag v1.0.1 && git push origin v1.0.1`. GitHub Actions compile les versions Windows, Mac et Android et les attache à la Release.
