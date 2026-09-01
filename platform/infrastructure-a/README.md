# Infrastructure A (Baseline)

Infrastructure A is the experimental baseline. It is **protected**: nothing in
Infrastructure B's provisioning or cleanup tooling is permitted to touch it.

## Resources created

| Kind | Name | Namespace |
|---|---|---|
| Namespace | `cloudport` | (cluster-scoped) |
| PersistentVolumeClaim | `cloudport-storage-a` | `cloudport` |
| Deployment | `cloudport-app-a` | `cloudport` |
| Service | `cloudport-service-a` | `cloudport` |

All resources are labeled `cloudport.io/protected: "true"`.
`platform/infrastructure-b/cleanup.sh` explicitly refuses to delete any
resource carrying this label, and its resource inventory check independently
verifies it is only ever targeting the fixed Infrastructure B resource list.

## Apply (manual, deliberate step)

```bash
kubectl apply -f platform/infrastructure-a/00-namespace.yaml
kubectl apply -f platform/infrastructure-a/01-pvc.yaml
kubectl apply -f platform/infrastructure-a/02-deployment.yaml
kubectl apply -f platform/infrastructure-a/03-service.yaml
```

## Verify

```bash
kubectl -n cloudport get deployment cloudport-app-a
kubectl -n cloudport get pvc cloudport-storage-a
kubectl -n cloudport rollout status deployment/cloudport-app-a
```

Live verification of the above against a real Kind/Korifi cluster requires a
host environment with Docker Desktop, Kind, and kubectl -- it was **NOT
VERIFIED** in the environment that produced this repository. The manifests
have been checked for YAML/schema validity only (see `scripts/validate-manifests.sh`).
