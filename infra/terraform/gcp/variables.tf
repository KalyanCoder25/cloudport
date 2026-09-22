# ---------------------------------------------------------------------------
# GCP Root Variables
# ---------------------------------------------------------------------------

variable "project_name" {
  description = "Short identifier used for resource naming."
  type        = string
  default     = "cloudport-capstone"
}

variable "environment" {
  description = "Deployment environment tag."
  type        = string
  default     = "capstone"
}

variable "gcp_project_id" {
  description = "GCP project ID. Must be set in terraform.tfvars — no default."
  type        = string
}

variable "region" {
  description = "GCP region for the GKE cluster and associated resources (Mumbai: asia-south1)."
  type        = string
  default     = "asia-south1"
}

variable "vpc_cidr" {
  description = "Primary IP range for the VPC subnetwork."
  type        = string
  default     = "10.0.0.0/16"
}

variable "pods_cidr" {
  description = "Secondary IP range for Kubernetes pods (VPC-native)."
  type        = string
  default     = "10.1.0.0/16"
}

variable "services_cidr" {
  description = "Secondary IP range for Kubernetes services (VPC-native)."
  type        = string
  default     = "10.2.0.0/20"
}

variable "kubernetes_version" {
  description = "Minimum Kubernetes master version."
  type        = string
  default     = "1.31"
}

variable "release_channel" {
  description = "GKE release channel: RAPID, REGULAR, STABLE, or UNSPECIFIED."
  type        = string
  default     = "REGULAR"
}

variable "node_machine_type" {
  description = "GCP machine type for worker nodes."
  type        = string
  default     = "e2-medium"
}

variable "node_count" {
  description = "Initial number of nodes per zone."
  type        = number
  default     = 1
}

variable "node_min_count" {
  description = "Minimum nodes per zone for autoscaling."
  type        = number
  default     = 1
}

variable "node_max_count" {
  description = "Maximum nodes per zone for autoscaling."
  type        = number
  default     = 3
}

variable "node_disk_size_gb" {
  description = "Boot disk size in GB for each GKE worker node."
  type        = number
  default     = 30
}

variable "node_disk_type" {
  description = "Boot disk type: pd-standard, pd-balanced, or pd-ssd."
  type        = string
  default     = "pd-standard"
}

variable "cluster_name_override" {
  description = "Override the computed cluster name."
  type        = string
  default     = "cloudport-capstone-gke"
}

variable "enable_workload_identity" {
  description = "Enable Workload Identity for secure pod-level GCP IAM access."
  type        = bool
  default     = true
}

variable "deletion_protection" {
  description = "Enable Terraform deletion protection. Set false for capstone cleanup."
  type        = bool
  default     = false
}
