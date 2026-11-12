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

## Guide d'utilisation

### 1. Premier lancement : les réglages (une seule fois)

Il faut trois informations, à récupérer sur HelloAsso avec un compte administrateur de l'association :

| Réglage | Où le trouver |
|---|---|
| **Client ID** et **Client Secret** | HelloAsso > *Mon compte* > *Intégrations et API* |
| **Slug de l'organisation** | Dans l'adresse de la page HelloAsso de l'association : `helloasso.com/associations/`**`mon-asso`** → le slug est `mon-asso` |

1. Cliquez sur **Réglages** (la page s'ouvre directement dessus la première fois).
2. Remplissez ces trois champs. Laissez les autres tels quels.
3. Cliquez sur **Tester la connexion** : le nom de l'association doit s'afficher en vert.
4. Cliquez sur **Enregistrer**. La liste des adhérents se charge.

Le **Client Secret** est un mot de passe : ne le communiquez pas, ne l'envoyez pas par e-mail.

### 2. Faire un trombinoscope

1. Cliquez sur **Actualiser** pour récupérer les dernières adhésions.
2. Choisissez les adhérents à imprimer :
   - un clic sur une carte la coche ou la décoche ;
   - **Tout sélectionner** / **Tout désélectionner** ;
   - **Sélectionner les nouveaux** coche seulement ceux qui n'ont jamais été imprimés (pratique en cours d'année) ;
   - **Filtre** : tapez un nom pour retrouver quelqu'un.
3. Si besoin, changez le **Titre** (en haut de chaque page) et cochez ou non **Afficher la date d'adhésion**.
4. Cliquez sur **Trombinoscope (n)** (n = nombre d'adhérents cochés). Choisissez une imprimante, ou **Enregistrer au format PDF**. 20 adhérents par page A4.
5. Après l'impression, l'outil demande s'il faut **marquer ces adhérents comme imprimés** : répondez **OK** pour qu'ils ne soient plus proposés par « Sélectionner les nouveaux ». Un badge vert « déjà imprimé » s'affiche sur leur carte.

### 3. Retirer quelqu'un du trombinoscope

- Le bouton **Retirer** d'une carte la cache de l'outil (par exemple une personne qui ne souhaite pas y figurer). **Rien n'est supprimé chez HelloAsso.**
- Pour la remettre : bouton **Retirés (n)**, puis **Remettre** à côté de son nom.

### 4. Qui apparaît dans la liste ?

- Seulement les **adhésions** (pas les dons), payées, non annulées ni remboursées.
- Seulement les montants payés listés dans **Réglages > Montants payés à retenir** (par défaut 100, 110, 160 et 170 €). Videz ce champ pour garder tous les montants.
- Une personne qui a adhéré plusieurs fois n'apparaît qu'une fois, avec la fiche qui a une photo.
- Une carte avec **?** à la place de la photo : l'adhérent n'a pas fourni de photo sur HelloAsso.

Si la liste est vide, le message affiché indique les montants et formulaires trouvés : ajustez **Montants payés à retenir** en conséquence. Le bouton **Diagnostic** (dans Réglages) montre une adhésion brute telle que HelloAsso la renvoie, utile pour signaler un problème.

### 5. Fermer l'outil

- **Windows / Mac** : bouton **Quitter** en haut de la page. Sinon, l'outil s'arrête tout seul 30 minutes après la fermeture de l'onglet.
- **Android** : quittez l'appli normalement.

### Où sont stockées les données ?

Uniquement sur l'appareil, rien n'est envoyé ailleurs qu'à HelloAsso :

- Windows : `%APPDATA%\Trombinoscope-HelloAsso\`
- Mac : `~/Library/Application Support/Trombinoscope-HelloAsso/`
- Android : mémoire privée de l'appli (effacée si on la désinstalle)

## Dépannage Mac

**Avant tout**, installez avec la ligne de Terminal (voir *Sur Mac* plus haut) : elle évite presque tous les blocages.

| Problème | Solution |
|---|---|
| « Apple n'a pas pu confirmer… », « développeur non identifié » ou « endommagé » | Cliquez sur **Terminé** (pas « Corbeille »), puis *Réglages Système > Confidentialité et sécurité* > tout en bas **Ouvrir quand même**. Relancez et confirmez **Ouvrir**. Sinon, dans le Terminal : `xattr -dr com.apple.quarantine /Applications/Trombinoscope.app` puis relancez. |
| Double-clic sans effet (pas de message, pas de navigateur) | Une ancienne instance tourne encore : *Moniteur d'activité* > « Trombinoscope » > **✕** > **Forcer à quitter**, puis relancez. Ou dans le Terminal : `pkill -f Trombinoscope.app` |
| L'outil tourne mais le navigateur ne s'ouvre pas | Ouvrez vous-même **http://127.0.0.1:3737** dans Safari ou Chrome. |
| Bandeau rouge « L'application Trombinoscope est fermée » | Arrêt automatique après 30 min d'inactivité : relancez l'appli puis rechargez la page (**Cmd + R**). |
| « Ne peut pas être ouverte » / « non prise en charge sur ce Mac » | Mauvaise version : menu  > *À propos de ce Mac*. Puce Apple M1 à M4 → **AppleSilicon** ; Processeur Intel → **Intel**. La ligne de Terminal choisit automatiquement. |
| Le script affiche `curl: (6)`, `(7)` ou `(22)` | Problème de connexion ou GitHub indisponible : réessayez un peu plus tard. |

**Repartir de zéro** (les réglages sont conservés) :

```
pkill -f Trombinoscope.app; rm -rf /Applications/Trombinoscope.app
curl -fsSL https://raw.githubusercontent.com/Nerdyeu/Hello-Asso-Tool/main/install-mac.sh | bash
```

Pour effacer aussi les réglages : `rm -rf ~/Library/Application\ Support/Trombinoscope-HelloAsso`

**Si rien ne marche**, notez la version de macOS (menu  > *À propos de ce Mac*), le message exact (ou une capture d'écran), et ce qu'affiche cette commande dans le Terminal (arrêt avec **Ctrl + C**) :

```
/Applications/Trombinoscope.app/Contents/MacOS/Trombinoscope
```

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
