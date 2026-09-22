# ---------------------------------------------------------------------------
# GCP Root Outputs
# ---------------------------------------------------------------------------

output "cluster_name" {
  description = "Name of the GKE cluster."
  value       = module.gke.cluster_name
}

output "cluster_location" {
  description = "Location (region or zone) of the GKE cluster."
  value       = module.gke.cluster_location
}

output "vpc_network_name" {
  description = "Name of the VPC network."
  value       = module.gke.vpc_network_name
}

output "workload_identity_pool" {
  description = "Workload Identity pool for pod-level GCP IAM bindings."
  value       = module.gke.workload_identity_pool
}

output "kubeconfig_command" {
  description = "Run this command after terraform apply to configure kubectl."
  value       = module.gke.kubeconfig_command
}
