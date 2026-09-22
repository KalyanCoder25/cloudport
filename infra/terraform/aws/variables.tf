# ---------------------------------------------------------------------------
# AWS Root Variables
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

variable "region" {
  description = "AWS region to deploy the EKS cluster (Mumbai: ap-south-1)."
  type        = string
  default     = "ap-south-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets (worker nodes)."
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets (load balancers, NAT)."
  type        = list(string)
  default     = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
}

variable "kubernetes_version" {
  description = "Kubernetes version for the EKS cluster."
  type        = string
  default     = "1.31"
}

variable "node_instance_type" {
  description = "EC2 instance type for worker nodes."
  type        = string
  default     = "t3.medium"
}

variable "node_desired_count" {
  description = "Desired number of worker nodes."
  type        = number
  default     = 3
}

variable "node_min_count" {
  description = "Minimum number of worker nodes."
  type        = number
  default     = 2
}

variable "node_max_count" {
  description = "Maximum number of worker nodes."
  type        = number
  default     = 5
}

variable "node_disk_size_gb" {
  description = "EBS disk size in GB for each worker node."
  type        = number
  default     = 20
}

variable "cluster_name_override" {
  description = "Override the computed cluster name."
  type        = string
  default     = "cloudport-capstone-eks"
}

variable "cluster_endpoint_public_access" {
  description = "Whether to enable public access to the EKS API endpoint."
  type        = bool
  default     = true
}

variable "cluster_endpoint_public_access_cidrs" {
  description = "CIDR blocks allowed to access the EKS public API endpoint."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
