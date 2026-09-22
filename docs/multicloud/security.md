# CloudPort Multi-Cloud Capstone — Security & Credential Handling

## Core Rule

**No credentials, keys, or secrets are ever committed to source control.**

This applies to:
- AWS access keys and secret keys
- GCP service account private keys
- Kubernetes kubeconfig files with embedded credentials
- Terraform state files (may contain infrastructure details)
- `.env` files

## What IS in source control

| File | Contains | Safe? |
|---|---|---|
| `infra/terraform/aws/terraform.tfvars.example` | Placeholder values only | ✅ Yes |
| `infra/terraform/gcp/terraform.tfvars.example` | Placeholder values only | ✅ Yes |
| `.env.example` | Placeholder values + documentation | ✅ Yes |
| Terraform modules (`*.tf`) | Resource definitions, no credentials | ✅ Yes |
| Kubernetes manifests | No credentials, no secrets | ✅ Yes |

## What is in .gitignore

```
*.tfstate            # Terraform state
*.tfstate.backup     # State backups
.terraform/          # Provider cache
*.tfvars             # Real variable files (not .example)
gcp-sa-key.json      # GCP service account keys
kubeconfig-*.yaml    # Generated kubeconfig files
.env                 # Real environment variables
```

## AWS Authentication

**Recommended**: AWS IAM Identity Center (SSO)

```bash
# One-time setup
aws configure sso

# Session login (before running terraform)
aws sso login --profile your-profile
export AWS_PROFILE=your-profile

# Verify
aws sts get-caller-identity
```

**Alternative**: Named profiles in `~/.aws/credentials`
Set `AWS_PROFILE` in your shell environment. Never export `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in permanent configuration files.

## GCP Authentication

**Recommended**: Application Default Credentials

```bash
# Authenticate
gcloud auth application-default login

# Set project
gcloud config set project your-gcp-project-id

# Verify
gcloud auth application-default print-access-token
```

**Alternative**: Service account key file

```bash
# Create key (restrict permissions — principle of least privilege)
# Point to it via environment variable (never commit the file)
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json
```

Add `sa-key.json` and `*-sa-key.json` to `.gitignore` (already done).

## Terraform State Security

Terraform state can contain sensitive infrastructure details (cluster endpoints, CAs).

For the capstone:
- Local state (`terraform.tfstate`) is acceptable for solo use
- Never commit `terraform.tfstate` (in `.gitignore`)
- For team use, configure an S3 backend (AWS) or GCS backend (GCP) with server-side encryption:

```hcl
# AWS — uncomment in infra/terraform/aws/main.tf
backend "s3" {
  bucket  = "your-state-bucket"
  key     = "cloudport-capstone/aws/terraform.tfstate"
  region  = "ap-south-1"
  encrypt = true
}

# GCP — uncomment in infra/terraform/gcp/main.tf
backend "gcs" {
  bucket = "your-state-bucket"
  prefix = "cloudport-capstone/gcp"
}
```

## Kubernetes Credentials

After `terraform apply`:

```bash
# AWS — merges credentials into ~/.kube/config
aws eks update-kubeconfig --name cloudport-capstone-eks --alias aws-eks-cloudport

# GCP — merges credentials into ~/.kube/config
gcloud container clusters get-credentials cloudport-capstone-gke --region asia-south1
```

The generated credentials live in `~/.kube/config`. Never copy this file into the repository.
Generated kubeconfig files (`kubeconfig-*.yaml`) are in `.gitignore`.

## Pre-Commit Checklist

Before any commit, verify:

```bash
# Check for accidentally staged credential files
git status
git diff --cached --name-only | grep -E "(tfstate|tfvars$|\.env$|sa-key|credentials)"

# Check for accidental credential content in staged files
git diff --cached | grep -iE "(access_key|secret_key|private_key|password)"
```

## Minimum IAM Permissions

### AWS EKS (minimum required)

The Terraform AWS root requires an IAM user/role with permissions to:
- Create/manage VPC, subnets, route tables, NAT gateways
- Create/manage EKS clusters and node groups
- Create/manage IAM roles and policy attachments (for EKS)
- Create/manage security groups

Do NOT grant `AdministratorAccess`. Use least-privilege IAM policies.

### GCP GKE (minimum required)

The Terraform GCP root requires a service account or authenticated user with:
- `container.admin` or `container.clusterAdmin`
- `compute.networkAdmin` (VPC, subnets, NAT)
- `iam.serviceAccountAdmin` (Workload Identity)

Do NOT grant `Owner` or `Editor`. Use least-privilege IAM roles.
