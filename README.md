# Envoy Gateway for K8s Dockside

A plugin for the [K8s Dockside](https://github.com/k8sdockside/k8sdockside)
desktop app that shows [Envoy Gateway](https://gateway.envoyproxy.io/) as what
it does: carry traffic from a listener, through a route, to a backend.

It answers the questions you have when a request does not arrive: which Gateway
and listener it came in on, which route took it, which Service it was sent to,
what policies shaped it on the way, and exactly where the path breaks. In plain
words, not as rows of custom resources.

Plain HTML and script, no build step: the repository is the plugin.

Needs **K8s Dockside 0.1.1 or newer** and Envoy Gateway in the cluster.
Prometheus is optional, for the traffic charts.

## What it shows

**Overview**, which replaces the app's generated overview page:

- A verdict ("Every Gateway is serving", "3 problems stopping traffic") and a
  sentence on what is configured.
- Tiles for Gateways serving, listeners working, routes attached, backends
  reachable, policies accepted and proxies ready. Each opens where to look next.
- Every Gateway as a card: its addresses, each listener with its protocol,
  port, hostname and routes, its proxy pods, and the policies attached.
- **Needs attention**: what is wrong, worst first, each opening the object at
  fault — a route a Gateway did not accept and why, a Service that does not
  exist, a Service with nothing ready behind it (Envoy answers 503), a TLS
  certificate that cannot be found, a policy whose target does not exist.
- Recent events for Gateways, routes, policies and the proxies.
- Requests by response class, the share of server errors, p95 latency, open
  connections and the backends answering the most 5xx, when the cluster has a
  Prometheus scraping the Envoy proxies.

**Traffic map** is the working page:

- Gateways and their listeners, the routes attached to them, and the Services
  those routes send requests to, joined by lines.
- A broken link is drawn broken, where it breaks.
- Hover anything to light up the path through it; click it for the details:
  a route's rules as *what it matches → where it sends it*, with traffic
  weights and each backend's ready endpoints.
- Filter by Gateway, find by host, route, Service or address, or show only
  what has a problem.

**Policies** lists every ClientTrafficPolicy, BackendTrafficPolicy,
SecurityPolicy, EnvoyExtensionPolicy and EnvoyPatchPolicy by what it is for,
with what it is attached to, whether Envoy Gateway accepted it, and what it
does in words — "Rate limit: 100 requests per minute, per proxy", "Retries 3
times on 502, 503", "Requires a JWT from https://…".

**Panels in detail views**

- **Gateway**: whether it is served, its addresses and proxies, every listener
  with its TLS certificate, its routes and what is wrong with it, the policies
  on it, and the proxy pods with their logs.
- **HTTPRoute / GRPCRoute**: which Gateways accepted it and why not, its hosts,
  its rules as match → backends, and its policies.
- **Each policy kind**: what it does, what it applies to, and which Gateways
  accepted it.

**Charts on objects**, from Prometheus: requests, latency and connections on a
Gateway; requests, errors and backend latency per rule on a route.

**Tables** for EnvoyProxies, every policy kind, Backends, HTTPRouteFilters, the
Envoy proxy pods and the controller's pods.

## Installing

In K8s Dockside, **Settings → Plugins → From a repository**, with this address:

```
https://github.com/k8sdockside/envoy.git
```

Updates come with the plugin card's **Update from repository** button.

## What it reads, and what it writes

It **only reads**. It never changes anything in the cluster, and its manifest
says so (`"write": false`), so the app would refuse a change even if a page
asked for one.

It reads:

- Envoy Gateway's own kinds: EnvoyProxies, ClientTrafficPolicies,
  BackendTrafficPolicies, SecurityPolicies, EnvoyExtensionPolicies,
  EnvoyPatchPolicies, Backends and HTTPRouteFilters.
- The Gateway API: GatewayClasses, Gateways, HTTPRoutes, GRPCRoutes, TLSRoutes,
  TCPRoutes and UDPRoutes.
- Services and EndpointSlices, to say whether a backend exists and has
  anything ready behind it.
- Pods, for the proxies and the controller, and events.

It never reads Secrets — the app does not allow a plugin to — so a TLS
certificate is named, not opened.

## How it recognises Envoy Gateway

- GatewayClasses whose `controllerName` is
  `gateway.envoyproxy.io/gatewayclass-controller`, and the Gateways using them.
  Gateways of other controllers in the same cluster are left out.
- Proxy pods by the labels Envoy Gateway puts on them:
  `app.kubernetes.io/managed-by=envoy-gateway`,
  `app.kubernetes.io/component=proxy`, and
  `gateway.envoyproxy.io/owning-gateway-name` / `-namespace` for which Gateway
  each one serves.
- The controller by `control-plane=envoy-gateway`, as the Helm chart labels it.
- The traffic charts use the Envoy proxies' standard metrics
  (`envoy_http_downstream_rq_xx`, `envoy_cluster_upstream_rq_*`, …). The charts
  on a Gateway find its proxies by the pod names Envoy Gateway gives them,
  `envoy-<namespace>-<gateway>-…`, and those on a route by Envoy Gateway's
  cluster names, `httproute/<namespace>/<route>/rule/<n>`.

## Developing

Clone it into a folder K8s Dockside watches for plugins (**Settings →
Plugins** shows the folder, and can watch another), then press **Reload**. A
page you change is picked up when you reopen its tab.

The same checks the app runs on load:

```sh
go run github.com/k8sdockside/k8sdockside/cmd/plugincheck@main .
```

```
plugin.json        the manifest
ui/model.js        reads the cluster and joins it up: gateways, routes, backends, policies, findings
ui/kit.js          elements, icons, pills, number formats, the line chart
ui/parts.js        what several pages draw alike: a Gateway card, policy chips, a route's rules
ui/overview.*      the overview
ui/index.html      the traffic map (map.js)
ui/policies.*      the policies page
ui/gateway.*, route.*, policy.*, panel.js   the panels in detail views
ui/envoy.css       every page's styles, from the app's theme tokens
```

## License

Apache 2.0 — see [LICENSE](LICENSE).
