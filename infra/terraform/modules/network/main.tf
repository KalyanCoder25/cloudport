# ---------------------------------------------------------------------------
# Network Module — Main
#
# This module is a documentation and naming-convention layer.
# It does NOT create provider-specific resources (VPCs are provider-specific
# and are created in the aws/ and gcp/ root modules using this module's
# variable schema for consistency).
#
# Usage pattern:
#   module "network" {
#     source             = "../modules/network"
#     project_name       = "cloudport-capstone"
#     environment        = "capstone"
#     vpc_cidr           = "10.0.0.0/16"
#     subnet_cidrs       = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
#     availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]
#   }
#
# The outputs of this module (common_tags, vpc_cidr, subnet_cidrs) are
# consumed by the EKS and GKE modules to ensure consistent resource tagging.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.6.0"
}

locals {
  common_tags = merge(var.tags, {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Capstone    = "cloudport-multicloud"
  })
}
