/**
 * Concept2 Webhook Handler
 *
 * This Cloudflare Worker handles incoming webhooks from Concept2 Logbook API
 * and triggers GitHub Repository Dispatch events to initiate TCX downloads.
 *
 * Configuration:
 * - Set GITHUB_PAT secret: wrangler secret put GITHUB_PAT
 * - Update REPO_OWNER and REPO_NAME if needed
 */

const REPO_OWNER = 'AEliu';
const REPO_NAME = 'concept2-backup';
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`;

export default {
  async fetch(request, env, ctx) {
    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      // Parse the incoming webhook JSON body
      const webhookData = await request.json();

      // Extract result_id from the webhook payload
      // Concept2 webhook format: { "user_id": 123, "result_id": 456 }
      const resultId = webhookData.result_id;

      if (!resultId) {
        console.error('Missing result_id in webhook payload');
        return new Response(
          JSON.stringify({ error: 'Missing result_id in request body' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      console.log(`Processing webhook for result_id: ${resultId}`);

      // Check for GitHub PAT
      const githubPat = env.GITHUB_PAT;
      if (!githubPat) {
        console.error('GITHUB_PAT environment variable not set');
        return new Response(
          JSON.stringify({ error: 'Server configuration error: GITHUB_PAT not set' }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Trigger GitHub Repository Dispatch event
      const githubResponse = await fetch(GITHUB_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubPat}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event_type: 'c2_new_activity',
          client_payload: {
            result_id: resultId
          }
        })
      });

      if (!githubResponse.ok) {
        const errorText = await githubResponse.text();
        console.error(`GitHub API error: ${githubResponse.status} - ${errorText}`);
        return new Response(
          JSON.stringify({
            error: 'Failed to trigger GitHub workflow',
            details: `GitHub API returned ${githubResponse.status}`
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      console.log(`Successfully triggered GitHub workflow for result_id: ${resultId}`);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Webhook processed successfully',
          result_id: resultId
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );

    } catch (error) {
      console.error(`Error processing webhook: ${error.message}`);
      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          message: error.message
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }
};
