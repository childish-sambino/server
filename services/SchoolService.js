const School = require('../models/School')
const ObjectId = require('mongoose').Types.ObjectId
const crypto = require('crypto')

// helper to escape regex special characters
function escapeRegex(str) {
  return str.replace(/[.*|\\+?{}()[^$]/g, c => '\\' + c)
}

function createUpchieveId() {
  const hex = crypto.randomBytes(4).toString('hex')
  const parsedHex = parseInt(hex, 16)
  return String(parsedHex).slice(0, 8)
}

module.exports = {
  // search for schools by name or ID
  search: function(query, cb) {
    if (query.match(/^[0-9]{8}$/)) {
      School.findByUpchieveId(query, cb)
    } else {
      const regex = new RegExp(escapeRegex(query), 'i')
      // look for both manually entered and auto-downloaded schools
      const dbQuery = School.find({
        $or: [{ nameStored: regex }, { SCH_NAME: regex }]
      })
        .sort({
          isApproved: -1
        })
        .limit(20)

      dbQuery.exec(function(err, results) {
        if (err) {
          cb(err)
        } else {
          cb(
            null,
            results
              .sort((s1, s2) => s1.name - s2.name)
              .map(school => {
                return {
                  _id: school._id,
                  upchieveId: school.upchieveId,
                  name: school.name,
                  districtName: school.districtName,
                  city: school.city,
                  state: school.state
                }
              })
          )
        }
      })
    }
  },

  getSchool: async function(schoolId) {
    try {
      const [school] = await School.aggregate([
        { $match: { _id: ObjectId(schoolId) } },
        {
          $project: {
            name: {
              $cond: {
                if: { $not: ['$nameStored'] },
                then: '$SCH_NAME',
                else: '$nameStored'
              }
            },
            state: {
              $cond: {
                if: { $not: ['$stateStored'] },
                then: '$ST',
                else: '$stateStored'
              }
            },
            city: {
              $cond: {
                if: { $not: ['$cityNameStored'] },
                then: '$LCITY',
                else: '$cityNameStored'
              }
            },
            zipCode: '$MZIP',
            isApproved: '$isApproved',
            approvalNotifyEmails: 1
          }
        }
      ]).exec()

      return school
    } catch (error) {
      throw new Error(error.message)
    }
  },

  getSchools: async function({ name, state, city, page }) {
    const pageNum = parseInt(page) || 1
    const PER_PAGE = 15
    const skip = (pageNum - 1) * PER_PAGE
    const queries = []

    if (name) {
      const nameQuery = {
        $or: [
          { nameStored: { $regex: name, $options: 'i' } },
          { SCH_NAME: { $regex: name, $options: 'i' } }
        ]
      }
      queries.push(nameQuery)
    }
    if (state) {
      const stateQuery = {
        $or: [
          { ST: { $regex: state, $options: 'i' } },
          { stateStored: { $regex: state, $options: 'i' } }
        ]
      }
      queries.push(stateQuery)
    }
    if (city) {
      const cityQuery = {
        $or: [
          { city: { $regex: city, $options: 'i' } },
          { MCITY: { $regex: city, $options: 'i' } },
          { LCITY: { $regex: city, $options: 'i' } }
        ]
      }
      queries.push(cityQuery)
    }

    let query = { $and: queries }
    // Search for all the schools if no queries were provided
    if (queries.length === 0) query = {}

    try {
      const schools = await School.aggregate([
        {
          $match: query
        },
        {
          $project: {
            name: {
              $cond: {
                if: { $not: ['$nameStored'] },
                then: '$SCH_NAME',
                else: '$nameStored'
              }
            },
            state: {
              $cond: {
                if: { $not: ['$stateStored'] },
                then: '$ST',
                else: '$stateStored'
              }
            },
            city: {
              $cond: {
                if: { $not: ['$cityNameStored'] },
                then: '$LCITY',
                else: '$cityNameStored'
              }
            },
            zipCode: '$MZIP',
            isApproved: '$isApproved'
          }
        }
      ])
        .skip(skip)
        .limit(PER_PAGE)
        .exec()

      const isLastPage = schools.length < PER_PAGE
      return { schools, isLastPage }
    } catch (error) {
      throw new Error(error.message)
    }
  },

  updateApproval: function(schoolId, isApproved) {
    return School.updateOne({ _id: schoolId }, { isApproved })
  },

  createSchool: async function({ name, city, state, zipCode, isApproved }) {
    let upchieveId = createUpchieveId()
    let existingSchool = await School.findOne({ upchieveId })
      .lean()
      .exec()

    // Avoid collision with schools containing the same upchieveId
    while (existingSchool) {
      upchieveId = createUpchieveId()
      existingSchool = await School.findOne({ upchieveId })
        .lean()
        .exec()
    }

    const schoolData = {
      isApproved,
      nameStored: name,
      cityNameStored: city,
      stateStored: state,
      MZIP: zipCode,
      LZIP: zipCode,
      upchieveId
    }
    const school = new School(schoolData)

    return school.save()
  },

  adminUpdateSchool: async function({
    schoolId,
    name,
    city,
    state,
    zipCode,
    isApproved
  }) {
    const schoolData = {
      isApproved,
      nameStored: name,
      cityNameStored: city,
      stateStored: state,
      MZIP: zipCode,
      LZIP: zipCode
    }

    return School.updateOne({ _id: schoolId }, schoolData)
  }
}
