// Representative Glances 4 payload: Celsius is raw; a name-only device is valid.
export const smartFixture = [
  { DeviceName: "sdc Example SSD", key: "DeviceName" },
  {
    DeviceName: "sdd Example HDD",
    key: "DeviceName",
    SerialNumber: "fixture-private-serial",
    194: {
      name: "Temperature_Celsius",
      key: "Temperature_Celsius",
      raw: "34 (Min/Max 14/61)",
      value: "060",
      worst: 60,
      private: "fixture-private-attribute",
    },
    9: { name: "Power_On_Hours", raw: "38715" },
  },
  {
    DeviceName: "sde Example HDD",
    194: {
      name: "Temperature_Celsius",
      raw: "33 (Min/Max 3/63)",
      value: "062",
    },
  },
  {
    DeviceName: "sdf Example HDD",
    194: {
      name: "Temperature_Celsius",
      raw: "34 (Min/Max 15/60)",
      value: "060",
    },
  },
  {
    DeviceName: "sdg Example HDD",
    194: {
      name: "Temperature_Celsius",
      raw: "33 (Min/Max 15/57)",
      value: "062",
    },
  },
];
