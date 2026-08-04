package stackable

default admin = false

# Admin if user ID is in the hardcoded admin list
admin if {
  admin_users[input.user.id]
}

# Admin if user email ends with the admin domain
admin if {
  endswith(input.user.email, "@admin.example.com")
}

admin_users := {
  "admin-user-id-1": true,
  "admin-user-id-2": true,
}
