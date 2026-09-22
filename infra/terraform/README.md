# Terraform Multi-Cloud Infrastructure — CloudPort Capstone

## Structure

```
infra/terraform/
├── modules/
│   ├── network/          # Shared naming/tagging conventions
│   ├── eks/              # AWS EKS cluster module
│   └── gke/              # GCP GKE cluster module
│
├── aws/                  # AWS provider root (calls eks module)
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── terraform.tfvars.example
│
├── gcp/                  # GCP provider root (calls gke module)
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── terraform.tfvars.example
│
├── validate-all.sh       # Safe validation (fmt + validate + plan only)
├── destroy-aws.sh        # Safe AWS EKS cleanup (manual confirmation)
└── destroy-gcp.sh        # Safe GCP GKE cleanup (manual confirmation)
```

## Constants vs. Provider-Specific Differences

### Held Constant (capstone invariants)

| Variable | Value | Purpose |
|---|---|---|
| Kubernetes version | 1.31 | Same control plane API on both clouds |
| Node count | 3 (AWS) / 3 regional (GCP: 1/zone × 3 zones) | Comparable compute capacity |
| Benchmark namespace | `online-boutique` | Same application namespace |
| Benchmark app version | `v0.10.1` | Same application version and Kustomize config |
| Locust load profile | 50 users, 5/s spawn, 300s | Same load stimulus |
| Kubernetes context names | `aws-eks-cloudport` / `gcp-gke-cloudport` | Explicit cross-cloud isolation |

### Unavoidable Provider-Specific Differences

| Dimension | AWS EKS | GCP GKE | Classification |
|---|---|---|---|
| **Node type** | `t3.medium` (2 vCPU, 4 GB RAM) | `e2-medium` (2 vCPU, 4 GB RAM) | INFRASTRUCTURE_DIFFERENCE (comparable, not identical) |
| **Load Balancer** | AWS ELB/NLB | GCP Cloud Load Balancer | INFRASTRUCTURE_DIFFERENCE |
| **StorageClass** | `ebs.csi.aws.com` | `pd.csi.storage.gke.io` | INFRASTRUCTURE_DIFFERENCE |
| **CNI** | AWS VPC CNI | GKE Dataplane v2 (eBPF) | INFRASTRUCTURE_DIFFERENCE |
| **IAM model** | AWS IAM + node instance roles | GCP IAM + Workload Identity | INFRASTRUCTURE_DIFFERENCE |
| **Node labels** | `eks.amazonaws.com/nodegroup` | `cloud.google.com/gke-nodepool` | INFRASTRUCTURE_DIFFERENCE |
| **Control plane SLA** | AWS EKS managed | GCP GKE managed | INFRASTRUCTURE_DIFFERENCE |

None of these differences are automatically classified as application leakage.
Application-visible effects must be measured under the same load profile.

## Quick Start (Validation Only — No Cloud Resources)

```bash
# AWS
cd infra/terraform/aws
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values (no credentials in file)
terraform init -backend=false
terraform fmt -check
terraform validate
terraform plan

# GCP
cd infra/terraform/gcp
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set gcp_project_id
terraform init -backend=false
terraform fmt -check
terraform validate
terraform plan
```

## Provisioning (Requires Explicit Approval)

```bash
# AWS — after reviewing plan
cd infra/terraform/aws
terraform apply  # type 'yes' when prompted

# After apply — configure kubectl
$(terraform output -raw kubeconfig_command)

# GCP — after reviewing plan
cd infra/terraform/gcp
terraform apply  # type 'yes' when prompted

# After apply — configure kubectl
$(terraform output -raw kubeconfig_command)
```

## Cleanup

```bash
# After experiments — run manually
bash infra/terraform/destroy-aws.sh
bash infra/terraform/destroy-gcp.sh
```

## Authentication

See `docs/multicloud/security.md` for the complete credential safety guide.

- **AWS**: Use `aws sso login` (IAM Identity Center) or `AWS_PROFILE`. Never embed keys in files.
- **GCP**: Use `gcloud auth application-default login`. Never commit service account keys.
