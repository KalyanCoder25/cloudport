# ---------------------------------------------------------------------------
# Network Module Outputs
#
# Exports VPC / subnet IDs that the EKS and GKE modules consume.
# The module itself is a documentation/convention layer; the actual
# provider-specific resources are in the aws/ and gcp/ root modules.
# ---------------------------------------------------------------------------

output "vpc_cidr" {
  description = "The configured VPC CIDR block."
  value       = var.vpc_cidr
}

output "subnet_cidrs" {
  description = "The configured subnet CIDR blocks."
  value       = var.subnet_cidrs
}

output "availability_zones" {
  description = "The configured availability zones."
  value       = var.availability_zones
}

output "common_tags" {
  description = "Merged common tags for all resources in this network context."
  value = merge(var.tags, {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Capstone    = "cloudport-multicloud"
  })
}
