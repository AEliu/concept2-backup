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
      console.log(`[${new Date().toISOString()}] Rejected ${request.method} request`);
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      // Parse the incoming webhook JSON body
      const webhookData = await request.json();

      console.log(`[${new Date().toISOString()}] Received webhook:`, JSON.stringify(webhookData, null, 2));

      const eventType = webhookData.type;

      console.log(`[${new Date().toISOString()}] Event type: ${eventType}`);

      let resultId = null;

      // Handle different event types
      if (eventType === 'result-added' || eventType === 'result-updated') {
        // For added/updated events, result is in webhookData.result
        if (!webhookData.result || !webhookData.result.id) {
          console.error(`[${new Date().toISOString()}] Missing result.id in ${eventType} event`);
          return new Response(
            JSON.stringify({ error: `Missing result.id in ${eventType} event` }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        resultId = webhookData.result.id;
        console.log(`[${new Date().toISOString()}] Processing ${eventType} for result_id: ${resultId}`);

      } else if (eventType === 'result-deleted') {
        // For deleted events, result_id is directly in webhookData
        if (!webhookData.result_id) {
          console.error(`[${new Date().toISOString()}] Missing result_id in ${eventType} event`);
          return new Response(
            JSON.stringify({ error: `Missing result_id in ${eventType} event` }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        resultId = webhookData.result_id;
        console.log(`[${new Date().toISOString()}] Processing ${eventType} for result_id: ${resultId}`);
        // Note: We still trigger the workflow for deletion events
        // The workflow can decide how to handle it (e.g., delete the file)

      } else {
        console.error(`[${new Date().toISOString()}] Unknown event type: ${eventType}`);
        return new Response(
          JSON.stringify({ error: `Unknown event type: ${eventType}` }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Check for GitHub PAT
      const githubPat = env.GITHUB_PAT;
      if (!githubPat) {
        console.error(`[${new Date().toISOString()}] GITHUB_PAT environment variable not set`);
        return new Response(
          JSON.stringify({ error: 'Server configuration error: GITHUB_PAT not set' }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Trigger GitHub Repository Dispatch event
      console.log(`[${new Date().toISOString()}] Triggering GitHub workflow for result_id: ${resultId}, event_type: ${eventType}`);

      const githubResponse = await fetch(GITHUB_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubPat}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'Concept2-Webhook-Handler/1.0'
        },
        body: JSON.stringify({
          event_type: 'c2_new_activity',
          client_payload: {
            result_id: resultId,
            event_type: eventType
          }
        })
      });

      if (!githubResponse.ok) {
        const errorText = await githubResponse.text();
        console.error(`[${new Date().toISOString()}] GitHub API error: ${githubResponse.status} - ${errorText}`);
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

      console.log(`[${new Date().toISOString()}] Successfully triggered GitHub workflow for result_id: ${resultId}`);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Webhook processed successfully',
          result_id: resultId,
          event_type: eventType
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );

    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error processing webhook: ${error.message}`);
      console.error(`[${new Date().toISOString()}] Stack trace:`, error.stack);
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
