# Local application deployment via Korifi

`LocalKubernetesProvider` (`application/backend/src/deployments/deploymentProviders.js`)
deploys user applications to the `kind-korifi` cluster through the real Cloud
Foundry CLI (`cf`), not through raw `kubectl apply`. This is what
`POST /api/deployments/:id/start` uses when `target_provider` is `local_k8s`.

## What it actually does

1. Ensures a `cloudport` CF org exists, and a space per CloudPort application
   (`cloudport-<app-slug>`), so different applications' deployments never
   share a CF space.
2. `cf target -o cloudport -s <space>`.
3. If the app was already pushed and is merely stopped, `cf start` (fast). Otherwise
   `cf push`, detached (`child_process.spawn(..., { detached: true })`) rather than
   awaited, because kpack staging routinely takes minutes and the HTTP request that
   triggered the deploy must not block for that long.
4. The route Korifi assigns is deterministic: `https://<cf-app-name>.<CF_APPS_DOMAIN>`
   (default `apps-127-0-0-1.nip.io`, matching this cluster's `defaultDomainName`).
5. `getStatus()` is the source of truth. It never reports `RUNNING` on the Cloud
   Controller's `STARTED` state alone -- it also probes the route over HTTPS
   (self-signed cert, verification scoped to that one request) and only claims
   `RUNNING` once the route actually answers.

A GitHub-sourced deployment (`source_type: GITHUB`) is shallow-cloned to a temp
directory and that is what gets pushed; a deployment with no usable source
falls back to `demo-app/` and says so in `metadata.sourceKind`.

## Known local-cluster gotcha: kpack builds stuck in `ImagePullBackOff`

If `cf push` never leaves the staging phase and `kubectl get pods -n <space-guid>`
shows the build pod stuck on `Init:ImagePullBackOff`, the kind node has lost two
pieces of state that Korifi's own setup writes once at cluster-creation time and
that do **not** reliably survive the node container being recreated (e.g. by a
Docker Desktop restart):

1. **DNS for the in-cluster image registry.** The node's containerd pulls images
   using the node's own `/etc/resolv.conf`, not the cluster's CoreDNS -- so
   `localregistry-docker-registry.default.svc.cluster.local` fails to resolve at
   the node level even though pods can resolve it fine.
2. **The registry's insecure/HTTP hosts config.** Even once DNS resolves,
   containerd defaults to HTTPS and the in-cluster registry serves plain HTTP,
   producing `http: server gave HTTP response to HTTPS client`.

Diagnose with (`MSYS_NO_PATHCONV=1` prefix needed in Git Bash so `/etc/...` isn't
rewritten to a Windows path):

```bash
kubectl describe build <build-name> -n <space-guid>   # look for ImagePullBackOff / TLS errors
MSYS_NO_PATHCONV=1 docker exec korifi-control-plane getent hosts \
  localregistry-docker-registry.default.svc.cluster.local
```

Fix (idempotent -- safe to run whether or not it's already broken; this repairs
the kind node's own OS-level config and never touches Korifi's Kubernetes
resources):

```bash
export MSYS_NO_PATHCONV=1  # Git Bash only

# 1. Node-level DNS for the in-cluster registry
REGISTRY_IP=$(kubectl get svc localregistry-docker-registry -n default -o jsonpath='{.spec.clusterIP}')
docker exec korifi-control-plane sh -c \
  "echo '$REGISTRY_IP localregistry-docker-registry.default.svc.cluster.local' >> /etc/hosts"

# 2. Tell containerd this registry is plain HTTP, not HTTPS
docker exec korifi-control-plane mkdir -p \
  "/etc/containerd/certs.d/localregistry-docker-registry.default.svc.cluster.local:30050"
docker exec korifi-control-plane sh -c 'cat > \
  "/etc/containerd/certs.d/localregistry-docker-registry.default.svc.cluster.local:30050/hosts.toml" <<EOF
server = "http://localregistry-docker-registry.default.svc.cluster.local:30050"

[host."http://localregistry-docker-registry.default.svc.cluster.local:30050"]
  capabilities = ["pull", "resolve", "push"]
EOF'
```

Then delete the stuck app (`cf delete <app> -f -r`) and retry -- no containerd
restart is required; the CRI registry config is read on each pull.
