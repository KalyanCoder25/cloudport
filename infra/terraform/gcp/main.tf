# ---------------------------------------------------------------------------
# GCP Provider Root — CloudPort Capstone GKE
#
# Usage:
#   cd infra/terraform/gcp
#   cp terraform.tfvars.example terraform.tfvars   # fill in real values
#   terraform init
#   terraform fmt -check
#   terraform validate
#   terraform plan                                 # review before applying
#   terraform apply                                # requires explicit approval
#
# CREDENTIAL SAFETY:
#   Never put GCP service account keys in terraform.tfvars or source code.
#   Use one of:
#     1. Application Default Credentials:
#          gcloud auth application-default login
#     2. Workload Identity Federation (CI/CD)
#     3. Service account key file pointed to by GOOGLE_APPLICATION_CREDENTIALS
#        environment variable (never commit the key file)
#
# COST SAFETY:
#   terraform apply provisions real GCP resources that incur charges.
#   Run `terraform plan` first. Use `bash ../destroy-gcp.sh` to clean up.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Backend configuration: uncomment and configure for team use.
  # backend "gcs" {
  #   bucket = "your-terraform-state-bucket"
  #   prefix = "cloudport-capstone/gcp"
  # }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.region
}

# ---------------------------------------------------------------------------
# GKE Module
# ---------------------------------------------------------------------------

module "gke" {
  source = "../modules/gke"

  project_name   = var.project_name
  environment    = var.environment
  gcp_project_id = var.gcp_project_id
  region         = var.region

  vpc_cidr      = var.vpc_cidr
  pods_cidr     = var.pods_cidr
  services_cidr = var.services_cidr

  kubernetes_version = var.kubernetes_version
  release_channel    = var.release_channel
  node_machine_type  = var.node_machine_type
  node_count         = var.node_count
  node_min_count     = var.node_min_count
  node_max_count     = var.node_max_count
  node_disk_size_gb  = var.node_disk_size_gb
  node_disk_type     = var.node_disk_type

  cluster_name_override    = var.cluster_name_override
  enable_workload_identity = var.enable_workload_identity
  deletion_protection      = var.deletion_protection

  labels = {
    kubernetes_context = "gcp-gke-cloudport"
  }
}
