# ---------------------------------------------------------------------------
# Network Module Variables
#
# Generic VPC / subnet inputs shared between AWS and GCP network modules.
# Provider-specific parameters are passed through the `provider_config` map.
# ---------------------------------------------------------------------------

variable "project_name" {
  description = "Short identifier used for resource naming (e.g. 'cloudport-capstone')."
  type        = string
}

variable "environment" {
  description = "Deployment environment tag (e.g. 'capstone', 'dev')."
  type        = string
  default     = "capstone"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC (AWS) or the primary VPC subnet range (GCP)."
  type        = string
  default     = "10.0.0.0/16"
}

variable "subnet_cidrs" {
  description = "List of CIDR blocks for subnets (multi-AZ for AWS; one primary + one secondary for GCP)."
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "availability_zones" {
  description = "Availability zones / regions for subnets. AWS: AZ list. GCP: single region."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Additional resource tags / labels to apply to all network resources."
  type        = map(string)
  default     = {}
}
