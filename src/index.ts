/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const routes = (customDomain: string): Record<string, string> => ({
	// production
	[customDomain]: 'https://registry-1.docker.io',
	[`quay.${customDomain}`]: 'https://quay.io',
	[`gcr.${customDomain}`]: 'https://gcr.io',
	[`k8s-gcr.${customDomain}`]: 'https://k8s.gcr.io',
	[`k8s.${customDomain}`]: 'https://registry.k8s.io',
	[`ghcr.${customDomain}`]: 'https://ghcr.io',
	[`cloudsmith.${customDomain}`]: 'https://docker.cloudsmith.io',
	[`ecr.${customDomain}`]: 'https://public.ecr.aws',
	[`docker-staging.${customDomain}`]: 'https://registry-1.docker.io',
});

const authRoutes = (customDomain: string): Record<string, string> => ({
	// production
	[customDomain]: 'https://auth.docker.io/token',
	[`quay.${customDomain}`]: 'https://quay.io/v2/auth',
	[`gcr.${customDomain}`]: 'https://gcr.io/v2/token',
	[`ghcr.${customDomain}`]: 'https://ghcr.io/token',
	[`cloudsmith.${customDomain}`]: 'https://docker.cloudsmith.io/login',
	[`ecr.${customDomain}`]: 'https://public.ecr.aws/token/',
	[`docker-staging.${customDomain}`]: 'https://auth.docker.io/token',
});

const replaceAuthenticate = (authenticateStr: string, hostname: string): string => {
	return authenticateStr.replace(/(realm=")[^"]*(")/, `$1https://${hostname}/auth$2`);
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const CUSTOM_DOMAIN = env.CUSTOM_DOMAIN;

	if (url.pathname === '/auth') {
		const routeMap = authRoutes(CUSTOM_DOMAIN);
		const authUrl = routeMap[url.hostname];

		return fetch(authUrl + url.search, {
			method: 'GET',
			headers: request.headers,
			redirect: 'follow',
		});
	}

	const routeMap = routes(CUSTOM_DOMAIN);
	const upstream = routeMap[url.hostname] || '';

	if (!upstream) {
		return new Response(
			JSON.stringify({
				routes: routeMap,
				host: url.hostname,
			}),
			{ status: 404 }
		);
	}

	if (url.pathname === '/v2/') {
		const newUrl = new URL(upstream + '/v2/');
		let resp = await fetch(newUrl.toString(), {
			method: 'GET',
			headers: request.headers,
			redirect: 'follow',
		});

		if (resp.status === 401) {
			const newHeaders = new Headers(resp.headers);
			const wwwAuthenticate = newHeaders.get('www-authenticate');
			if (wwwAuthenticate) {
				newHeaders.set('www-authenticate', replaceAuthenticate(wwwAuthenticate, url.hostname));
			}
			resp = new Response(resp.body, { ...resp, headers: newHeaders });
		}
		return resp;
	}

	const newUrl = new URL(upstream + url.pathname);
	let newReq = new Request(newUrl, {
		method: request.method,
		headers: request.headers,
		redirect: 'manual',
	});

	let resp = await fetch(newReq);

	if (resp.status === 307) {
		const location = resp.headers.get('location');
		if (!location) return resp;
		newReq = new Request(location, { method: request.method });
		resp = await fetch(newReq);
		return resp;
	}

	if (resp.status === 401) {
		const newHeaders = new Headers(resp.headers);
		const wwwAuthenticate = newHeaders.get('www-authenticate');
		if (wwwAuthenticate) {
			newHeaders.set('www-authenticate', replaceAuthenticate(wwwAuthenticate, url.hostname));
		}
		resp = new Response(resp.body, { ...resp, headers: newHeaders });
	}

	return resp;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return handleRequest(request, env);
	},
} satisfies ExportedHandler<Env>;
