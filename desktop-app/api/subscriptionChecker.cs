using System;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Text;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using System.Management;
using System.Linq;
using System.Collections.Generic;

namespace CS2Loader.Desktop.Api
{
    public class SubscriptionChecker
    {
        private readonly WebApiClient _apiClient;
        private readonly string _cacheFilePath;
        private readonly TimeSpan _cacheExpiration = TimeSpan.FromMinutes(15);
        
        public SubscriptionChecker(WebApiClient apiClient)
        {
            _apiClient = apiClient ?? throw new ArgumentNullException(nameof(apiClient));
            _cacheFilePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), 
                "CS2Loader", "subscription_cache.dat");
            
            // Ensure cache directory exists
            Directory.CreateDirectory(Path.GetDirectoryName(_cacheFilePath));
        }

        /// <summary>
        /// Check if the current user has an active subscription
        /// </summary>
        /// <returns>Subscription status result</returns>
        public async Task<SubscriptionStatus> CheckSubscriptionAsync()
        {
            try
            {
                var hwid = await GetHardwareIdAsync();
                if (string.IsNullOrEmpty(hwid))
                {
                    return new SubscriptionStatus
                    {
                        IsActive = false,
                        Error = "Failed to generate hardware ID"
                    };
                }

                // Try to get cached result first
                var cachedResult = GetCachedSubscription(hwid);
                if (cachedResult != null && !cachedResult.IsExpired)
                {
                    return cachedResult.Status;
                }

                // Check subscription via API
                var apiResult = await _apiClient.CheckSubscriptionByHwidAsync(hwid);
                
                if (apiResult.IsSuccess)
                {
                    var subscriptionStatus = new SubscriptionStatus
                    {
                        IsActive = apiResult.Data.HasActiveSubscription,
                        ProductName = apiResult.Data.ProductName,
                        ExpiresAt = apiResult.Data.ExpiresAt,
                        DaysRemaining = apiResult.Data.DaysRemaining,
                        TimeRemaining = apiResult.Data.TimeRemaining,
                        Hwid = hwid,
                        LastChecked = DateTime.UtcNow
                    };

                    // Cache the result
                    CacheSubscription(hwid, subscriptionStatus);
                    
                    return subscriptionStatus;
                }
                else
                {
                    // If network request fails, try to use cached result even if expired
                    if (cachedResult != null)
                    {
                        cachedResult.Status.IsFromCache = true;
                        cachedResult.Status.Warning = "Network unavailable, using cached data";
                        return cachedResult.Status;
                    }

                    return new SubscriptionStatus
                    {
                        IsActive = false,
                        Error = apiResult.ErrorMessage ?? "Failed to check subscription"
                    };
                }
            }
            catch (Exception ex)
            {
                return new SubscriptionStatus
                {
                    IsActive = false,
                    Error = $"Subscription check failed: {ex.Message}"
                };
            }
        }

        /// <summary>
        /// Validate subscription and return detailed status
        /// </summary>
        /// <param name="requireActive">Whether to require an active subscription</param>
        /// <returns>Validation result</returns>
        public async Task<ValidationResult> ValidateSubscriptionAsync(bool requireActive = true)
        {
            var subscriptionStatus = await CheckSubscriptionAsync();
            
            var result = new ValidationResult
            {
                IsValid = subscriptionStatus.IsActive,
                Status = subscriptionStatus,
                ValidationTime = DateTime.UtcNow
            };

            if (!subscriptionStatus.IsActive)
            {
                if (!string.IsNullOrEmpty(subscriptionStatus.Error))
                {
                    result.ValidationMessage = subscriptionStatus.Error;
                    result.ValidationType = ValidationType.Error;
                }
                else
                {
                    result.ValidationMessage = "No active subscription found";
                    result.ValidationType = ValidationType.NoSubscription;
                }
            }
            else if (subscriptionStatus.DaysRemaining <= 3)
            {
                result.ValidationMessage = $"Subscription expires in {subscriptionStatus.DaysRemaining} days";
                result.ValidationType = ValidationType.ExpiringsSoon;
            }
            else
            {
                result.ValidationMessage = $"Subscription active until {subscriptionStatus.ExpiresAt:MMM dd, yyyy}";
                result.ValidationType = ValidationType.Valid;
            }

            return result;
        }

        /// <summary>
        /// Get hardware ID for the current machine
        /// </summary>
        /// <returns>Unique hardware identifier</returns>
        public async Task<string> GetHardwareIdAsync()
        {
            try
            {
                var components = new List<string>();

                // Get CPU ID
                var cpuId = await GetCpuIdAsync();
                if (!string.IsNullOrEmpty(cpuId))
                    components.Add($"CPU:{cpuId}");

                // Get Motherboard Serial
                var mbSerial = await GetMotherboardSerialAsync();
                if (!string.IsNullOrEmpty(mbSerial))
                    components.Add($"MB:{mbSerial}");

                // Get MAC Address
                var macAddress = GetMacAddress();
                if (!string.IsNullOrEmpty(macAddress))
                    components.Add($"MAC:{macAddress}");

                // Get Windows Installation ID
                var windowsId = GetWindowsInstallationId();
                if (!string.IsNullOrEmpty(windowsId))
                    components.Add($"WIN:{windowsId}");

                if (components.Count == 0)
                {
                    throw new InvalidOperationException("Could not retrieve any hardware identifiers");
                }

                // Combine all components and hash them
                var combined = string.Join("|", components.OrderBy(x => x));
                using (var sha256 = SHA256.Create())
                {
                    var hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(combined));
                    return Convert.ToBase64String(hash).Replace("/", "_").Replace("+", "-").Substring(0, 32);
                }
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"Failed to generate hardware ID: {ex.Message}", ex);
            }
        }

        /// <summary>
        /// Clear cached subscription data
        /// </summary>
        public void ClearCache()
        {
            try
            {
                if (File.Exists(_cacheFilePath))
                {
                    File.Delete(_cacheFilePath);
                }
            }
            catch (Exception ex)
            {
                // Log error but don't throw
                System.Diagnostics.Debug.WriteLine($"Failed to clear subscription cache: {ex.Message}");
            }
        }

        private async Task<string> GetCpuIdAsync()
        {
            try
            {
                using (var searcher = new ManagementObjectSearcher("SELECT ProcessorId FROM Win32_Processor"))
                {
                    foreach (ManagementObject obj in searcher.Get())
                    {
                        return obj["ProcessorId"]?.ToString();
                    }
                }
            }
            catch
            {
                // Fallback method
                try
                {
                    var key = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0");
                    return key?.GetValue("Identifier")?.ToString();
                }
                catch { }
            }
            return null;
        }

        private async Task<string> GetMotherboardSerialAsync()
        {
            try
            {
                using (var searcher = new ManagementObjectSearcher("SELECT SerialNumber FROM Win32_BaseBoard"))
                {
                    foreach (ManagementObject obj in searcher.Get())
                    {
                        var serial = obj["SerialNumber"]?.ToString();
                        if (!string.IsNullOrEmpty(serial) && serial != "To be filled by O.E.M.")
                            return serial;
                    }
                }
            }
            catch { }
            return null;
        }

        private string GetMacAddress()
        {
            try
            {
                using (var searcher = new ManagementObjectSearcher("SELECT MACAddress FROM Win32_NetworkAdapter WHERE MACAddress IS NOT NULL AND NetConnectionStatus=2"))
                {
                    foreach (ManagementObject obj in searcher.Get())
                    {
                        return obj["MACAddress"]?.ToString();
                    }
                }
            }
            catch { }
            return null;
        }

        private string GetWindowsInstallationId()
        {
            try
            {
                var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography");
                return key?.GetValue("MachineGuid")?.ToString();
            }
            catch { }
            return null;
        }

        private CachedSubscription GetCachedSubscription(string hwid)
        {
            try
            {
                if (!File.Exists(_cacheFilePath))
                    return null;

                var encryptedData = File.ReadAllBytes(_cacheFilePath);
                var jsonData = DecryptData(encryptedData, hwid);
                
                return System.Text.Json.JsonSerializer.Deserialize<CachedSubscription>(jsonData);
            }
            catch
            {
                return null;
            }
        }

        private void CacheSubscription(string hwid, SubscriptionStatus status)
        {
            try
            {
                var cached = new CachedSubscription
                {
                    Status = status,
                    CachedAt = DateTime.UtcNow,
                    Hwid = hwid
                };

                var jsonData = System.Text.Json.JsonSerializer.Serialize(cached);
                var encryptedData = EncryptData(jsonData, hwid);
                
                File.WriteAllBytes(_cacheFilePath, encryptedData);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to cache subscription: {ex.Message}");
            }
        }

        private byte[] EncryptData(string data, string key)
        {
            using (var aes = Aes.Create())
            {
                var keyBytes = SHA256.HashData(Encoding.UTF8.GetBytes(key));
                aes.Key = keyBytes;
                aes.GenerateIV();

                using (var encryptor = aes.CreateEncryptor())
                using (var ms = new MemoryStream())
                {
                    ms.Write(aes.IV);
                    using (var cs = new CryptoStream(ms, encryptor, CryptoStreamMode.Write))
                    using (var writer = new StreamWriter(cs))
                    {
                        writer.Write(data);
                    }
                    return ms.ToArray();
                }
            }
        }

        private string DecryptData(byte[] encryptedData, string key)
        {
            using (var aes = Aes.Create())
            {
                var keyBytes = SHA256.HashData(Encoding.UTF8.GetBytes(key));
                aes.Key = keyBytes;

                var iv = new byte[16];
                Array.Copy(encryptedData, 0, iv, 0, 16);
                aes.IV = iv;

                using (var decryptor = aes.CreateDecryptor())
                using (var ms = new MemoryStream(encryptedData, 16, encryptedData.Length - 16))
                using (var cs = new CryptoStream(ms, decryptor, CryptoStreamMode.Read))
                using (var reader = new StreamReader(cs))
                {
                    return reader.ReadToEnd();
                }
            }
        }
    }

    public class SubscriptionStatus
    {
        public bool IsActive { get; set; }
        public string ProductName { get; set; }
        public DateTime? ExpiresAt { get; set; }
        public int DaysRemaining { get; set; }
        public TimeRemainingInfo TimeRemaining { get; set; }
        public string Hwid { get; set; }
        public DateTime LastChecked { get; set; }
        public string Error { get; set; }
        public string Warning { get; set; }
        public bool IsFromCache { get; set; }

        public bool IsExpiringSoon => IsActive && DaysRemaining <= 7;
        public bool IsExpired => ExpiresAt.HasValue && DateTime.UtcNow >= ExpiresAt.Value;
    }

    public class TimeRemainingInfo
    {
        public int Days { get; set; }
        public int Hours { get; set; }
        public int Minutes { get; set; }

        public override string ToString()
        {
            if (Days > 0)
                return $"{Days} days, {Hours} hours";
            if (Hours > 0)
                return $"{Hours} hours, {Minutes} minutes";
            return $"{Minutes} minutes";
        }
    }

    public class ValidationResult
    {
        public bool IsValid { get; set; }
        public SubscriptionStatus Status { get; set; }
        public string ValidationMessage { get; set; }
        public ValidationType ValidationType { get; set; }
        public DateTime ValidationTime { get; set; }
    }

    public enum ValidationType
    {
        Valid,
        ExpiringsSoon,
        NoSubscription,
        Error
    }

    internal class CachedSubscription
    {
        public SubscriptionStatus Status { get; set; }
        public DateTime CachedAt { get; set; }
        public string Hwid { get; set; }
        
        public bool IsExpired => DateTime.UtcNow - CachedAt > TimeSpan.FromMinutes(15);
    }
}