using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Net;
using System.IO;
using System.Security.Cryptography;
using System.Threading;

namespace CS2Loader.Desktop.Integration
{
    public class WebApiClient : IDisposable
    {
        private readonly HttpClient _httpClient;
        private readonly string _baseUrl;
        private readonly JsonSerializerOptions _jsonOptions;
        private string _authToken;
        private readonly SemaphoreSlim _authSemaphore = new SemaphoreSlim(1, 1);

        public WebApiClient(string baseUrl, TimeSpan? timeout = null)
        {
            _baseUrl = baseUrl?.TrimEnd('/') ?? throw new ArgumentNullException(nameof(baseUrl));
            
            var handler = new HttpClientHandler()
            {
                ServerCertificateCustomValidationCallback = (sender, cert, chain, sslErrors) =>
                {
                    // In production, implement proper certificate validation
                    // For now, accept all certificates for local development
                    return true;
                }
            };

            _httpClient = new HttpClient(handler)
            {
                Timeout = timeout ?? TimeSpan.FromSeconds(30)
            };

            _httpClient.DefaultRequestHeaders.Add("User-Agent", "CS2Loader-Desktop/1.0");
            
            _jsonOptions = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                PropertyNameCaseInsensitive = true
            };
        }

        /// <summary>
        /// Check subscription status by HWID (no authentication required)
        /// </summary>
        /// <param name="hwid">Hardware ID</param>
        /// <returns>Subscription check result</returns>
        public async Task<ApiResult<SubscriptionResponse>> CheckSubscriptionByHwidAsync(string hwid)
        {
            if (string.IsNullOrEmpty(hwid))
                return ApiResult<SubscriptionResponse>.Failure("HWID is required");

            try
            {
                var endpoint = $"/api/desktop/subscription/{Uri.EscapeDataString(hwid)}";
                var response = await _httpClient.GetAsync($"{_baseUrl}{endpoint}");
                
                return await ProcessResponseAsync<SubscriptionResponse>(response);
            }
            catch (Exception ex)
            {
                return ApiResult<SubscriptionResponse>.Failure($"Network error: {ex.Message}");
            }
        }

        /// <summary>
        /// Login user and obtain authentication token
        /// </summary>
        /// <param name="email">User email</param>
        /// <param name="password">User password</param>
        /// <param name="hwid">Hardware ID</param>
        /// <returns>Login result</returns>
        public async Task<ApiResult<LoginResponse>> LoginAsync(string email, string password, string hwid)
        {
            if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password))
                return ApiResult<LoginResponse>.Failure("Email and password are required");

            try
            {
                var loginData = new
                {
                    email = email,
                    password = password,
                    hwid = hwid
                };

                var response = await PostAsync<LoginResponse>("/api/auth/login", loginData);
                
                if (response.IsSuccess && !string.IsNullOrEmpty(response.Data?.Token))
                {
                    SetAuthToken(response.Data.Token);
                }

                return response;
            }
            catch (Exception ex)
            {
                return ApiResult<LoginResponse>.Failure($"Login failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Redeem a product key
        /// </summary>
        /// <param name="keyCode">Product key code</param>
        /// <param name="hwid">Hardware ID</param>
        /// <returns>Redemption result</returns>
        public async Task<ApiResult<RedemptionResponse>> RedeemKeyAsync(string keyCode, string hwid)
        {
            if (string.IsNullOrEmpty(keyCode) || string.IsNullOrEmpty(hwid))
                return ApiResult<RedemptionResponse>.Failure("Key code and HWID are required");

            try
            {
                var redeemData = new
                {
                    keyCode = keyCode,
                    hwid = hwid
                };

                return await PostAsync<RedemptionResponse>("/api/keys/redeem", redeemData, requireAuth: true);
            }
            catch (Exception ex)
            {
                return ApiResult<RedemptionResponse>.Failure($"Key redemption failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Get user's active subscription
        /// </summary>
        /// <param name="hwid">Optional HWID filter</param>
        /// <returns>Subscription details</returns>
        public async Task<ApiResult<UserSubscriptionResponse>> GetUserSubscriptionAsync(string hwid = null)
        {
            try
            {
                var endpoint = "/api/keys/subscription";
                if (!string.IsNullOrEmpty(hwid))
                {
                    endpoint += $"?hwid={Uri.EscapeDataString(hwid)}";
                }

                return await GetAsync<UserSubscriptionResponse>(endpoint, requireAuth: true);
            }
            catch (Exception ex)
            {
                return ApiResult<UserSubscriptionResponse>.Failure($"Failed to get subscription: {ex.Message}");
            }
        }

        /// <summary>
        /// Validate current authentication token
        /// </summary>
        /// <returns>Token validation result</returns>
        public async Task<ApiResult<TokenValidationResponse>> ValidateTokenAsync()
        {
            if (string.IsNullOrEmpty(_authToken))
                return ApiResult<TokenValidationResponse>.Failure("No authentication token");

            try
            {
                return await GetAsync<TokenValidationResponse>("/api/auth/validate", requireAuth: true);
            }
            catch (Exception ex)
            {
                return ApiResult<TokenValidationResponse>.Failure($"Token validation failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Check API health
        /// </summary>
        /// <returns>Health check result</returns>
        public async Task<ApiResult<HealthResponse>> CheckHealthAsync()
        {
            try
            {
                var response = await _httpClient.GetAsync($"{_baseUrl}/health");
                return await ProcessResponseAsync<HealthResponse>(response);
            }
            catch (Exception ex)
            {
                return ApiResult<HealthResponse>.Failure($"Health check failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Logout and clear authentication token
        /// </summary>
        public async Task<ApiResult<object>> LogoutAsync()
        {
            try
            {
                if (!string.IsNullOrEmpty(_authToken))
                {
                    await PostAsync<object>("/api/auth/logout", null, requireAuth: true);
                }
                
                ClearAuthToken();
                return ApiResult<object>.Success(null);
            }
            catch (Exception ex)
            {
                ClearAuthToken(); // Clear token anyway
                return ApiResult<object>.Failure($"Logout failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Set authentication token
        /// </summary>
        /// <param name="token">JWT token</param>
        public void SetAuthToken(string token)
        {
            _authToken = token;
            if (!string.IsNullOrEmpty(token))
            {
                _httpClient.DefaultRequestHeaders.Authorization = 
                    new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            }
        }

        /// <summary>
        /// Clear authentication token
        /// </summary>
        public void ClearAuthToken()
        {
            _authToken = null;
            _httpClient.DefaultRequestHeaders.Authorization = null;
        }

        /// <summary>
        /// Check if client has valid authentication token
        /// </summary>
        public bool IsAuthenticated => !string.IsNullOrEmpty(_authToken);

        private async Task<ApiResult<T>> GetAsync<T>(string endpoint, bool requireAuth = false)
        {
            if (requireAuth && !await EnsureAuthenticatedAsync())
                return ApiResult<T>.Failure("Authentication required");

            try
            {
                var response = await _httpClient.GetAsync($"{_baseUrl}{endpoint}");
                return await ProcessResponseAsync<T>(response);
            }
            catch (Exception ex)
            {
                return ApiResult<T>.Failure($"GET request failed: {ex.Message}");
            }
        }

        private async Task<ApiResult<T>> PostAsync<T>(string endpoint, object data, bool requireAuth = false)
        {
            if (requireAuth && !await EnsureAuthenticatedAsync())
                return ApiResult<T>.Failure("Authentication required");

            try
            {
                string jsonContent = data != null ? JsonSerializer.Serialize(data, _jsonOptions) : "{}";
                var content = new StringContent(jsonContent, Encoding.UTF8, "application/json");
                
                var response = await _httpClient.PostAsync($"{_baseUrl}{endpoint}", content);
                return await ProcessResponseAsync<T>(response);
            }
            catch (Exception ex)
            {
                return ApiResult<T>.Failure($"POST request failed: {ex.Message}");
            }
        }

        private async Task<ApiResult<T>> ProcessResponseAsync<T>(HttpResponseMessage response)
        {
            try
            {
                var content = await response.Content.ReadAsStringAsync();
                
                if (response.IsSuccessStatusCode)
                {
                    if (typeof(T) == typeof(object) || string.IsNullOrEmpty(content))
                    {
                        return ApiResult<T>.Success(default(T));
                    }

                    var data = JsonSerializer.Deserialize<T>(content, _jsonOptions);
                    return ApiResult<T>.Success(data);
                }
                else
                {
                    // Try to parse error response
                    try
                    {
                        var errorResponse = JsonSerializer.Deserialize<ErrorResponse>(content, _jsonOptions);
                        return ApiResult<T>.Failure(errorResponse?.Error ?? $"HTTP {(int)response.StatusCode}: {response.ReasonPhrase}");
                    }
                    catch
                    {
                        return ApiResult<T>.Failure($"HTTP {(int)response.StatusCode}: {response.ReasonPhrase}");
                    }
                }
            }
            catch (Exception ex)
            {
                return ApiResult<T>.Failure($"Response processing failed: {ex.Message}");
            }
        }

        private async Task<bool> EnsureAuthenticatedAsync()
        {
            if (string.IsNullOrEmpty(_authToken))
                return false;

            await _authSemaphore.WaitAsync();
            try
            {
                // Validate current token
                var validation = await ValidateTokenAsync();
                return validation.IsSuccess;
            }
            finally
            {
                _authSemaphore.Release();
            }
        }

        public void Dispose()
        {
            _httpClient?.Dispose();
            _authSemaphore?.Dispose();
        }
    }

    // API Response Models
    public class ApiResult<T>
    {
        public bool IsSuccess { get; set; }
        public T Data { get; set; }
        public string ErrorMessage { get; set; }
        public int? StatusCode { get; set; }

        public static ApiResult<T> Success(T data) => new ApiResult<T> { IsSuccess = true, Data = data };
        public static ApiResult<T> Failure(string error, int? statusCode = null) => 
            new ApiResult<T> { IsSuccess = false, ErrorMessage = error, StatusCode = statusCode };
    }

    public class SubscriptionResponse
    {
        public bool HasActiveSubscription { get; set; }
        public string ProductName { get; set; }
        public DateTime? ExpiresAt { get; set; }
        public int DaysRemaining { get; set; }
        public TimeRemainingInfo TimeRemaining { get; set; }
    }

    public class LoginResponse
    {
        public string Message { get; set; }
        public string Token { get; set; }
        public UserInfo User { get; set; }
    }

    public class UserInfo
    {
        public string Id { get; set; }
        public string Email { get; set; }
        public string Role { get; set; }
        public bool EmailVerified { get; set; }
        public string Hwid { get; set; }
        public DateTime? LastLogin { get; set; }
    }

    public class RedemptionResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public SubscriptionInfo Subscription { get; set; }
        public KeyInfo Key { get; set; }
    }

    public class SubscriptionInfo
    {
        public string Id { get; set; }
        public string ProductName { get; set; }
        public int DurationDays { get; set; }
        public DateTime StartsAt { get; set; }
        public DateTime ExpiresAt { get; set; }
        public bool IsLifetime { get; set; }
    }

    public class KeyInfo
    {
        public string Code { get; set; }
        public DateTime RedeemedAt { get; set; }
    }

    public class UserSubscriptionResponse
    {
        public bool HasActiveSubscription { get; set; }
        public SubscriptionDetails Subscription { get; set; }
        public string Message { get; set; }
    }

    public class SubscriptionDetails
    {
        public string Id { get; set; }
        public string ProductName { get; set; }
        public int DurationDays { get; set; }
        public string Hwid { get; set; }
        public DateTime StartsAt { get; set; }
        public DateTime ExpiresAt { get; set; }
        public DateTime CreatedAt { get; set; }
        public string KeyCode { get; set; }
        public int DaysRemaining { get; set; }
        public string Status { get; set; }
        public bool IsLifetime { get; set; }
        public TimeRemainingInfo TimeRemaining { get; set; }
    }

    public class TokenValidationResponse
    {
        public bool Valid { get; set; }
        public UserInfo User { get; set; }
    }

    public class HealthResponse
    {
        public string Status { get; set; }
        public DateTime Timestamp { get; set; }
        public double Uptime { get; set; }
        public string Environment { get; set; }
    }

    public class ErrorResponse
    {
        public string Error { get; set; }
        public List<ValidationError> Details { get; set; }
    }

    public class ValidationError
    {
        public string Field { get; set; }
        public string Message { get; set; }
    }
}