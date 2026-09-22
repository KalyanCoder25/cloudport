# ---------------------------------------------------------------------------
# GKE Module Outputs
# ---------------------------------------------------------------------------

output "cluster_name" {
  description = "Name of the GKE cluster."
  value       = google_container_cluster.main.name
}

output "cluster_endpoint" {
  description = "Endpoint of the GKE Kubernetes API server."
  value       = google_container_cluster.main.endpoint
  sensitive   = true
}

output "cluster_ca_certificate" {
  description = "Base64-encoded certificate authority data for the GKE cluster."
  value       = google_container_cluster.main.master_auth[0].cluster_ca_certificate
  sensitive   = true
}

output "cluster_location" {
  description = "Location (region or zone) of the GKE cluster."
  value       = google_container_cluster.main.location
}

output "vpc_network_name" {
  description = "Name of the VPC network."
  value       = google_compute_network.main.name
}

output "subnet_name" {
  description = "Name of the primary subnetwork."
  value       = google_compute_subnetwork.main.name
}

output "workload_identity_pool" {
  description = "Workload Identity pool for the GKE cluster."
  value       = "${var.gcp_project_id}.svc.id.goog"
}

output "kubeconfig_command" {
  description = "gcloud command to configure kubectl context. Run this after terraform apply."
  value       = "gcloud container clusters get-credentials ${google_container_cluster.main.name} --region ${var.region} --project ${var.gcp_project_id} && kubectl config rename-context gke_${var.gcp_project_id}_${var.region}_${google_container_cluster.main.name} gcp-gke-cloudport"
}
