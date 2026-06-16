/**
 * setup-youtube-auth.js
 *
 * Run this ONCE to authorize the sentiment agent to read your YouTube
 * subscriptions. It creates token.json, which youtubeSentimentAgent.js
 * then reuses on every run -- you won't need to log in again unless you
 * revoke access.
 *
 * Usage:  node agents/sentiment/setup-youtube-auth.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { google } = require('googleapis');

const CLIENT_SECRET_PATH = path.join(__dirname, '..', '..', 'client_secret.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];

function main() {
  if (!fs.existsSync(CLIENT_SECRET_PATH)) {
    console.error(`\nCan't find client_secret.json at:\n  ${CLIENT_SECRET_PATH}\n`);
    console.error('Download it from Google Cloud Console (see SETUP_INSTRUCTIONS.md step 1) and place it in your project root.');
    process.exit(1);
  }

  const { installed } = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'));
  const oAuth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret, installed.redirect_uris[0]);

  const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.log('\n1. Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n2. Sign in, click Allow, then copy the code shown on the page.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('3. Paste that code here and press Enter: ', async (code) => {
    rl.close();
    try {
      const { tokens } = await oAuth2Client.getToken(code.trim());
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      console.log(`\nSaved token.json -- setup complete. You can now use youtubeSentimentAgent.js.\n`);
    } catch (err) {
      console.error('\nFailed to exchange code for token:', err.message);
      process.exit(1);
    }
  });
}

main();
